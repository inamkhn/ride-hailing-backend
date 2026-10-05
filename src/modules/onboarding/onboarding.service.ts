import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DocumentType, DriverDocument, Prisma, VerificationStatus } from '@prisma/client';
import { AuthError } from '../../common/errors/auth-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { RateLimitService } from '../../common/rate-limiting/rate-limit.service';
import {
  DRIVER_VERIFICATION_CHANGED,
  EventBus,
  PROFILE_VEHICLE_CHANGED,
  ProfileVehicleChanged,
} from '../../common/events/event-bus';
import { maskPhone } from '../auth/utils/phone.util';
import { StorageService } from './storage/storage.service';
import {
  ALLOWED_CONTENT_TYPES,
  ApproveInput,
  DocumentRecord,
  REQUIRED_DOC_TYPES,
  RejectInput,
  RevokeInput,
  StatusView,
  UploadUrlResponse,
} from './types/onboarding.types';

/** A verification row plus its documents, the working set for most methods. */
type VerificationWithDocs = Prisma.DriverVerificationGetPayload<{
  include: { documents: true };
}>;

/**
 * Per-driver rate limits (onboarding-module.md §10, "starting values, tunable").
 * Identity-keyed via the shared Redis RateLimitService — the global ThrottlerGuard is
 * IP-based and can't express a per-driver budget. Enforced on the write endpoints.
 */
const UPLOAD_URL_LIMIT = { prefix: 'ob:upload-url', limit: 20, windowSeconds: 3600 }; // 20 / hour / driver
const SUBMIT_LIMIT = { prefix: 'ob:submit', limit: 5, windowSeconds: 86400 }; // 5 / day / driver

/**
 * Driver document review & approval (onboarding-module.md). Owns the verification
 * lifecycle, the upload/submit flow, and the admin decisions. Backoffice routes are
 * thin callers into here. Identity always comes from the caller (JWT sub), never a
 * body field; every admin write + document view is audited; every status change
 * commits an audit row + outbox event atomically and fires the event only post-commit.
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly outbox: OutboxService,
    private readonly events: EventBus,
    private readonly rateLimiter: RateLimitService,
  ) {}

  /**
   * Fixed-window per-driver budget (§10). Throws 429 with a retry hint when exceeded.
   * Applied before any state/storage work so a throttled call is cheap.
   */
  private async assertWithinLimit(prefix: string, limit: number, windowSeconds: number, driverId: string): Promise<void> {
    const res = await this.rateLimiter.consume(`${prefix}:${driverId}`, limit, windowSeconds);
    if (!res.allowed) throw AuthError.rateLimited(res.retryAfterSeconds);
  }

  // ---------------------------------------------------------------- capability

  /** §8.1 go-available gate. True only when status = APPROVED. Never reads the token. */
  async isDriverApproved(driverId: string): Promise<boolean> {
    const v = await this.prisma.driverVerification.findUnique({
      where: { driverId },
      select: { status: true },
    });
    return v?.status === VerificationStatus.APPROVED;
  }

  /**
   * §8.3 vehicle change after approval -> re-review. Onboarding owns the verification
   * table, so it (not Profile) performs the reset. An approved driver who edits their
   * vehicle goes back to PENDING draft (submitted_at cleared) so the old registration
   * can't cover a new plate; they must re-submit. Profile only emits the event.
   */
  @OnEvent(PROFILE_VEHICLE_CHANGED)
  async onVehicleChanged(payload: ProfileVehicleChanged): Promise<void> {
    const v = await this.prisma.driverVerification.findUnique({
      where: { driverId: payload.driverId },
    });
    if (v?.status !== VerificationStatus.APPROVED) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.driverVerification.updateMany({
        where: { driverId: payload.driverId, status: VerificationStatus.APPROVED },
        data: {
          status: VerificationStatus.PENDING,
          submittedAt: null,
          rejectionReasonCode: null,
          rejectionMessage: null,
        },
      });
      await this.outbox.enqueue(
        DRIVER_VERIFICATION_CHANGED,
        { driverId: payload.driverId, from: VerificationStatus.APPROVED, to: VerificationStatus.PENDING, submissionNumber: v.submissionNumber },
        tx,
      );
    });

    this.events.emitDriverVerificationChanged({
      driverId: payload.driverId,
      from: VerificationStatus.APPROVED,
      to: VerificationStatus.PENDING,
      submissionNumber: v.submissionNumber,
    });
  }

  // ------------------------------------------------------------ driver: status

  /** GET /v1/onboarding/status (§5.1). */
  async getStatus(driverId: string): Promise<StatusView> {
    const v = await this.getOrCreate(driverId);
    const vehicle = await this.prisma.driver.findUnique({ where: { userId: driverId } });
    const current = this.currentDocs(v.documents);
    const missing = this.computeMissing(current, vehicle);

    const view: StatusView = {
      status: v.status,
      submitted: v.submittedAt !== null,
      submission_number: v.submissionNumber,
      documents: REQUIRED_DOC_TYPES.map((type) => {
        const doc = current.get(type);
        return {
          type,
          uploaded: !!doc,
          uploaded_at: doc ? doc.uploadedAt.toISOString() : null,
        };
      }),
      vehicle_details_complete: this.vehicleComplete(vehicle),
      missing,
    };
    if (v.status === VerificationStatus.REJECTED) {
      view.rejection_reason_code = v.rejectionReasonCode;
      view.rejection_message = v.rejectionMessage;
    }
    return view;
  }

  // ------------------------------------------------------- driver: upload flow

  /** POST /v1/onboarding/documents/upload-url (§5.2). */
  async requestUploadUrl(
    driverId: string,
    type: DocumentType,
    contentType: string,
    sizeBytes: number,
  ): Promise<UploadUrlResponse> {
    await this.assertWithinLimit(UPLOAD_URL_LIMIT.prefix, UPLOAD_URL_LIMIT.limit, UPLOAD_URL_LIMIT.windowSeconds, driverId);
    const v = await this.getOrCreate(driverId);
    this.assertEditable(v);

    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      throw AuthError.unsupportedFile('Only JPEG, PNG and PDF documents are accepted');
    }
    if (sizeBytes > this.storage.maxUploadBytes) {
      throw AuthError.fileTooLarge();
    }

    const key = this.storage.newStorageKey(driverId);
    const uploadUrl = await this.storage.presignPut(key, sizeBytes, contentType);
    return {
      upload_url: uploadUrl,
      storage_key: key,
      expires_in: Number(process.env.DOCUMENT_UPLOAD_URL_TTL_SECONDS ?? 600),
    };
  }

  /** POST /v1/onboarding/documents (§5.3). Re-verifies the object from storage, not the client. */
  async confirmUpload(
    driverId: string,
    type: DocumentType,
    storageKey: string,
  ): Promise<DocumentRecord> {
    const v = await this.getOrCreate(driverId);
    this.assertEditable(v);

    // Issuance proof: the key was generated under this driver's private prefix.
    if (!storageKey.startsWith(`driver-docs/${driverId}/`)) {
      throw AuthError.notYourUpload();
    }

    const meta = await this.storage.head(storageKey);
    if (!meta.exists) throw AuthError.uploadNotFound();
    if (
      !meta.contentType ||
      !ALLOWED_CONTENT_TYPES.includes(meta.contentType) ||
      meta.size === undefined ||
      meta.size > this.storage.maxUploadBytes
    ) {
      throw AuthError.fileMismatch();
    }

    const doc = await this.prisma.driverDocument.create({
      data: {
        verificationId: v.id,
        type,
        storageKey,
        contentType: meta.contentType,
        sizeBytes: meta.size,
        submissionNumber: null, // draft until submit stamps it (§4.2)
      },
    });
    return this.toRecord(doc);
  }

  /**
   * POST /v1/onboarding/submit (§5.4). One transaction: freeze the current draft
   * docs under a new submission_number, move PENDING(draft)/REJECTED -> PENDING(queued).
   */
  async submit(driverId: string): Promise<StatusView> {
    await this.assertWithinLimit(SUBMIT_LIMIT.prefix, SUBMIT_LIMIT.limit, SUBMIT_LIMIT.windowSeconds, driverId);
    const v = await this.getOrCreate(driverId);

    if (v.status === VerificationStatus.APPROVED) throw AuthError.alreadyApproved();
    if (v.status === VerificationStatus.PENDING && v.submittedAt) {
      throw AuthError.alreadySubmitted();
    }

    const vehicle = await this.prisma.driver.findUnique({ where: { userId: driverId } });
    const current = this.currentDocs(v.documents);
    const missing = this.computeMissing(current, vehicle);
    if (missing.length > 0) throw AuthError.incompleteSubmission(missing);

    const nextNumber = v.submissionNumber + 1;
    await this.prisma.$transaction(async (tx) => {
      await tx.driverVerification.update({
        where: { id: v.id },
        data: {
          status: VerificationStatus.PENDING,
          submittedAt: new Date(),
          submissionNumber: nextNumber,
          rejectionReasonCode: null,
          rejectionMessage: null,
        },
      });
      // Stamp the CURRENT document set (latest per type) with the new number so the
      // admin reviews a frozen snapshot. Includes docs carried over unchanged from a
      // prior submission in a partial resubmit — approve() later matches expiry by
      // this number, so every current doc of the reviewed set must carry it (§5.4/§6.3).
      const currentIds = [...current.values()].map((d) => d.id);
      await tx.driverDocument.updateMany({
        where: { id: { in: currentIds } },
        data: { submissionNumber: nextNumber },
      });
      await this.outbox.enqueue(
        'driver.onboarding.submitted',
        { driverId, submissionNumber: nextNumber },
        tx,
      );
    });

    return this.getStatus(driverId);
  }

  // ------------------------------------------------------------- admin: review

  /** GET /v1/admin/onboarding/queue (§6.1). FIFO oldest submitted first, cursor by submittedAt. */
  async queue(limit = 25, cursorSubmittedAt?: Date) {
    const take = Math.min(Math.max(limit, 1), 100);
    const rows = await this.prisma.driverVerification.findMany({
      where: {
        status: VerificationStatus.PENDING,
        submittedAt: cursorSubmittedAt ? { gt: cursorSubmittedAt } : { not: null },
      },
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
      take: take + 1, // one extra to detect a next page
      include: { driver: { select: { phoneNumber: true } } },
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const items = page.map((r) => ({
      driver_id: r.driverId,
      phone: r.driver.phoneNumber ? maskPhone(r.driver.phoneNumber) : null,
      submitted_at: r.submittedAt?.toISOString() ?? null,
      submission_number: r.submissionNumber,
      age_seconds: r.submittedAt
        ? Math.floor((Date.now() - r.submittedAt.getTime()) / 1000)
        : null,
      is_resubmission: r.submissionNumber > 1,
    }));
    const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].submittedAt : null;
    return {
      items,
      next_cursor: nextCursor ? nextCursor.toISOString() : null,
    };
  }

  /** GET /v1/admin/onboarding/:driver_id (§6.2). Mints short-lived view URLs; each is audited. */
  async detail(driverId: string, adminId: string) {
    const v = await this.prisma.driverVerification.findUnique({
      where: { driverId },
      include: { documents: true, driver: { select: { fullName: true, phoneNumber: true, createdAt: true } } },
    });
    if (!v) throw new NotFoundException('Driver verification not found');

    const vehicle = await this.prisma.driver.findUnique({ where: { userId: driverId } });
    const current = this.currentDocs(v.documents);
    const documents = [];
    for (const doc of current.values()) {
      const viewUrl = await this.storage.presignGet(doc.storageKey);
      documents.push({
        id: doc.id,
        type: doc.type,
        uploaded_at: doc.uploadedAt.toISOString(),
        content_type: doc.contentType,
        size_bytes: doc.sizeBytes,
        expires_on: doc.expiresOn?.toISOString() ?? null,
        view_url: viewUrl, // short-lived; never stored/logged
      });
      // Logging document views matters — these are identity documents (§9).
      await this.prisma.adminAuditLog.create({
        data: {
          adminId,
          action: 'view_document',
          targetType: 'driver_document',
          targetId: doc.id,
        },
      });
    }

    // Prior submission sets grouped by submission_number (oldest first).
    const grouped = new Map<number, number>();
    for (const d of v.documents) {
      if (d.submissionNumber !== null) {
        grouped.set(d.submissionNumber, (grouped.get(d.submissionNumber) ?? 0) + 1);
      }
    }
    const history = [...grouped.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([submission_number, document_count]) => ({ submission_number, document_count }));

    return {
      driver_id: driverId,
      name: v.driver.fullName,
      phone: v.driver.phoneNumber ? maskPhone(v.driver.phoneNumber) : null,
      account_created_at: v.driver.createdAt.toISOString(),
      vehicle: {
        make: vehicle?.vehicleMake ?? null,
        model: vehicle?.vehicleModel ?? null,
        plate: vehicle?.vehiclePlate ?? null,
      },
      status: v.status,
      submission_number: v.submissionNumber,
      documents,
      history,
    };
  }

  /** POST /v1/admin/onboarding/:driver_id/approve (§6.3). */
  async approve(driverId: string, adminId: string, input: ApproveInput): Promise<StatusView> {
    const v = await this.getExisting(driverId);
    // §7 decision idempotency: re-approving the SAME current submission returns the
    // status view with no second audit row and no duplicate event/notification.
    if (v.status === VerificationStatus.APPROVED && v.submissionNumber === input.submissionNumber) {
      return this.getStatus(driverId);
    }
    this.assertReviewable(v, input.submissionNumber);
    if (!input.licenseExpiresOn || !input.registrationExpiresOn) {
      throw AuthError.missingExpiry();
    }

    const changed = await this.prisma.$transaction(async (tx) => {
      // Compare-and-set on status + submission_number: exactly one admin wins (§7).
      const res = await tx.driverVerification.updateMany({
        where: {
          driverId,
          status: VerificationStatus.PENDING,
          submissionNumber: input.submissionNumber,
          submittedAt: { not: null },
        },
        data: {
          status: VerificationStatus.APPROVED,
          reviewedByAdminId: adminId,
          reviewedAt: new Date(),
        },
      });
      if (res.count !== 1) throw AuthError.notReviewable();

      // Record expiry per document type at approval (§6.3, §10).
      await tx.driverDocument.updateMany({
        where: { verificationId: v.id, type: DocumentType.LICENSE, submissionNumber: input.submissionNumber },
        data: { expiresOn: input.licenseExpiresOn },
      });
      await tx.driverDocument.updateMany({
        where: { verificationId: v.id, type: DocumentType.VEHICLE_REGISTRATION, submissionNumber: input.submissionNumber },
        data: { expiresOn: input.registrationExpiresOn },
      });
      if (input.backgroundCheckExpiresOn) {
        await tx.driverDocument.updateMany({
          where: { verificationId: v.id, type: DocumentType.BACKGROUND_CHECK, submissionNumber: input.submissionNumber },
          data: { expiresOn: input.backgroundCheckExpiresOn },
        });
      }

      await tx.adminAuditLog.create({
        data: {
          adminId,
          action: 'approve_onboarding',
          targetType: 'driver_verification',
          targetId: v.id,
          reason: input.note ?? null,
          metadata: { from: VerificationStatus.PENDING, to: VerificationStatus.APPROVED, submissionNumber: input.submissionNumber },
        },
      });
      await this.outbox.enqueue(
        DRIVER_VERIFICATION_CHANGED,
        { driverId, from: VerificationStatus.PENDING, to: VerificationStatus.APPROVED, submissionNumber: input.submissionNumber },
        tx,
      );
      return { from: VerificationStatus.PENDING, to: VerificationStatus.APPROVED };
    });

    this.events.emitDriverVerificationChanged({
      driverId,
      from: changed.from,
      to: changed.to,
      submissionNumber: input.submissionNumber,
    });
    return this.getStatus(driverId);
  }

  /** POST /v1/admin/onboarding/:driver_id/reject (§6.4). */
  async reject(driverId: string, adminId: string, input: RejectInput): Promise<StatusView> {
    const v = await this.getExisting(driverId);
    this.assertReviewable(v, input.submissionNumber);

    const changed = await this.prisma.$transaction(async (tx) => {
      const res = await tx.driverVerification.updateMany({
        where: {
          driverId,
          status: VerificationStatus.PENDING,
          submissionNumber: input.submissionNumber,
          submittedAt: { not: null },
        },
        data: {
          status: VerificationStatus.REJECTED,
          rejectionReasonCode: input.reasonCode,
          rejectionMessage: input.message,
          reviewedByAdminId: adminId,
          reviewedAt: new Date(),
        },
      });
      if (res.count !== 1) throw AuthError.notReviewable();

      await tx.adminAuditLog.create({
        data: {
          adminId,
          action: 'reject_onboarding',
          targetType: 'driver_verification',
          targetId: v.id,
          reason: input.message,
          metadata: { reasonCode: input.reasonCode, submissionNumber: input.submissionNumber },
        },
      });
      await this.outbox.enqueue(
        DRIVER_VERIFICATION_CHANGED,
        { driverId, from: VerificationStatus.PENDING, to: VerificationStatus.REJECTED, submissionNumber: input.submissionNumber },
        tx,
      );
      return { from: VerificationStatus.PENDING, to: VerificationStatus.REJECTED };
    });

    this.events.emitDriverVerificationChanged({
      driverId,
      from: changed.from,
      to: changed.to,
      submissionNumber: input.submissionNumber,
    });
    return this.getStatus(driverId);
  }

  /** POST /v1/admin/onboarding/:driver_id/revoke (§6.5) — pull an APPROVED driver back to REJECTED. */
  async revoke(driverId: string, adminId: string, input: RevokeInput): Promise<StatusView> {
    const v = await this.getExisting(driverId);
    if (v.status !== VerificationStatus.APPROVED) throw AuthError.notReviewable();

    const changed = await this.prisma.$transaction(async (tx) => {
      const res = await tx.driverVerification.updateMany({
        where: { driverId, status: VerificationStatus.APPROVED },
        data: {
          status: VerificationStatus.REJECTED,
          rejectionReasonCode: input.reasonCode,
          rejectionMessage: input.message,
          reviewedByAdminId: adminId,
          reviewedAt: new Date(),
        },
      });
      if (res.count !== 1) throw AuthError.notReviewable();

      await tx.adminAuditLog.create({
        data: {
          adminId,
          action: 'revoke_onboarding',
          targetType: 'driver_verification',
          targetId: v.id,
          reason: input.message,
          metadata: { reasonCode: input.reasonCode },
        },
      });
      await this.outbox.enqueue(
        DRIVER_VERIFICATION_CHANGED,
        { driverId, from: VerificationStatus.APPROVED, to: VerificationStatus.REJECTED, submissionNumber: v.submissionNumber },
        tx,
      );
      return { from: VerificationStatus.APPROVED, to: VerificationStatus.REJECTED };
    });

    // APPROVED -> REJECTED is the signal for Location/Dispatch forced-offline (§8.2).
    this.events.emitDriverVerificationChanged({
      driverId,
      from: changed.from,
      to: changed.to,
      submissionNumber: v.submissionNumber,
    });
    return this.getStatus(driverId);
  }

  // -------------------------------------------------------------- internal

  /** Verification must exist for a driver (created at signup); create defensively. */
  private async getOrCreate(driverId: string): Promise<VerificationWithDocs> {
    let v = await this.prisma.driverVerification.findUnique({
      where: { driverId },
      include: { documents: true },
    });
    if (!v) {
      await this.prisma.driverVerification.create({ data: { driverId, status: VerificationStatus.PENDING } });
      v = await this.prisma.driverVerification.findUnique({
        where: { driverId },
        include: { documents: true },
      });
    }
    return v as VerificationWithDocs;
  }

  private async getExisting(driverId: string): Promise<VerificationWithDocs> {
    const v = await this.prisma.driverVerification.findUnique({
      where: { driverId },
      include: { documents: true },
    });
    if (!v) throw new NotFoundException('Driver verification not found');
    return v;
  }

  /** Edits allowed only in draft (PENDING, not submitted) or REJECTED states (§5.2/§5.4). */
  private assertEditable(v: { status: VerificationStatus; submittedAt: Date | null }): void {
    if (v.status === VerificationStatus.APPROVED) {
      throw AuthError.alreadyApprovedLocked('Editing is locked once approved');
    }
    if (v.status === VerificationStatus.PENDING && v.submittedAt) {
      throw AuthError.alreadyApprovedLocked('Editing is locked while your submission is under review');
    }
  }

  /** Approve/reject preconditions: PENDING + submitted + the quoted submission is current (§6/§7). */
  private assertReviewable(v: { status: VerificationStatus; submittedAt: Date | null; submissionNumber: number }, quoted: number): void {
    if (v.status !== VerificationStatus.PENDING || !v.submittedAt) {
      throw AuthError.notReviewable();
    }
    if (v.submissionNumber !== quoted) throw AuthError.staleSubmission();
  }

  /** Newest row per type is the "current" document; older rows are history (§4.2). */
  private currentDocs(docs: DriverDocument[]): Map<DocumentType, DriverDocument> {
    const map = new Map<DocumentType, DriverDocument>();
    for (const d of docs) {
      const prev = map.get(d.type);
      if (!prev || d.uploadedAt > prev.uploadedAt) map.set(d.type, d);
    }
    return map;
  }

  private vehicleComplete(vehicle: { vehicleMake: string | null; vehicleModel: string | null; vehiclePlate: string | null } | null): boolean {
    return !!(vehicle?.vehicleMake && vehicle?.vehicleModel && vehicle?.vehiclePlate);
  }

  /** What still blocks submission: missing required docs + vehicle fields (§5.1 missing[]). */
  private computeMissing(
    current: Map<DocumentType, DriverDocument>,
    vehicle: { vehicleMake: string | null; vehicleModel: string | null; vehiclePlate: string | null } | null,
  ): string[] {
    const missing: string[] = [];
    for (const type of REQUIRED_DOC_TYPES) {
      if (!current.has(type)) missing.push(type);
    }
    if (!vehicle?.vehicleMake) missing.push('vehicle_make');
    if (!vehicle?.vehicleModel) missing.push('vehicle_model');
    if (!vehicle?.vehiclePlate) missing.push('vehicle_plate');
    return missing;
  }

  private toRecord(doc: DriverDocument): DocumentRecord {
    return {
      id: doc.id,
      type: doc.type,
      content_type: doc.contentType,
      size_bytes: doc.sizeBytes,
      uploaded_at: doc.uploadedAt.toISOString(),
      submission_number: doc.submissionNumber,
    };
  }
}
