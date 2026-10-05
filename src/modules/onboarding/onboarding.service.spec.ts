import { DocumentType, VerificationStatus } from '@prisma/client';
import { AuthError } from '../../common/errors/auth-error';
import { AuthErrorCode } from '../../common/errors/auth-error-codes';
import { OnboardingService } from './onboarding.service';

/**
 * Unit tests (no DB, no S3): the verification-state transition matrix, the
 * optimistic-concurrency guards (status + submission_number compare-and-set),
 * and the missing[] calculation. Prisma/Storage/Outbox/Events are fakes; the
 * transaction helper just invokes the callback with a tx double we can script.
 */

interface VOverride {
  status?: VerificationStatus;
  submittedAt?: Date | null;
  submissionNumber?: number;
  documents?: any[];
  rejectionReasonCode?: string | null;
  rejectionMessage?: string | null;
}

function makeVerification(o: VOverride = {}) {
  return {
    id: 'v-1',
    driverId: 'd-1',
    status: o.status ?? VerificationStatus.PENDING,
    submittedAt: o.submittedAt === undefined ? null : o.submittedAt,
    submissionNumber: o.submissionNumber ?? 0,
    rejectionReasonCode: o.rejectionReasonCode ?? null,
    rejectionMessage: o.rejectionMessage ?? null,
    reviewedByAdminId: null,
    reviewedAt: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    documents: o.documents ?? [],
  };
}

function draftDoc(type: DocumentType, uploadedAt = new Date('2024-01-02T00:00:00Z')) {
  return {
    id: `doc-${type}`,
    verificationId: 'v-1',
    type,
    storageKey: `driver-docs/d-1/${type.toLowerCase()}`,
    contentType: 'image/jpeg',
    sizeBytes: 1234,
    uploadedAt,
    submissionNumber: null,
    expiresOn: null,
  };
}

const COMPLETE_VEHICLE = {
  userId: 'd-1',
  vehicleMake: 'Toyota',
  vehicleModel: 'Corolla',
  vehiclePlate: 'ABC-1234',
};

describe('OnboardingService', () => {
  let prisma: any;
  let storage: any;
  let outbox: any;
  let events: any;
  let rateLimiter: any;
  let tx: any;
  let service: OnboardingService;

  /** make verification rows returned by driverVerification.findUnique per call. */
  function mockVerification(...rows: any[]) {
    prisma.driverVerification.findUnique.mockImplementation(async () =>
      rows.length === 1 ? rows[0] : rows.shift(),
    );
  }

  beforeEach(() => {
    tx = {
      driverVerification: { update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      driverDocument: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      adminAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      $transaction: jest.fn((cb: any) => cb(tx)),
      driverVerification: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
      },
      driver: { findUnique: jest.fn().mockResolvedValue(COMPLETE_VEHICLE) },
      driverDocument: { create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'doc-new', uploadedAt: new Date('2024-01-03T00:00:00Z'), submissionNumber: null, ...data })) },
      adminAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    storage = {
      maxUploadBytes: 10 * 1024 * 1024,
      newStorageKey: jest.fn(() => 'driver-docs/d-1/uuid-1'),
      presignPut: jest.fn(async () => 'https://storage/put?sig=1'),
      presignGet: jest.fn(async () => 'https://storage/get?sig=1'),
      head: jest.fn(async () => ({ exists: true, size: 1234, contentType: 'image/jpeg' })),
    };
    outbox = { enqueue: jest.fn(async () => ({})) };
    events = { emitDriverVerificationChanged: jest.fn(), emitProfileVehicleChanged: jest.fn() };
    rateLimiter = { consume: jest.fn(async () => ({ allowed: true })) };
    service = new OnboardingService(prisma, storage, outbox, events, rateLimiter);
  });

  // ----------------------------------------------------------- capability

  describe('isDriverApproved', () => {
    it('true only for APPROVED', async () => {
      mockVerification(makeVerification({ status: VerificationStatus.APPROVED }));
      await expect(service.isDriverApproved('d-1')).resolves.toBe(true);
    });
    it('false for PENDING', async () => {
      mockVerification(makeVerification({ status: VerificationStatus.PENDING }));
      await expect(service.isDriverApproved('d-1')).resolves.toBe(false);
    });
    it('false when no row exists', async () => {
      mockVerification(null);
      await expect(service.isDriverApproved('d-1')).resolves.toBe(false);
    });
  });

  // -------------------------------------------------------- status / missing

  describe('getStatus', () => {
    it('lists all required docs + vehicle fields as missing on a fresh draft', async () => {
      mockVerification(makeVerification());
      prisma.driver.findUnique.mockResolvedValue(null);
      const view = await service.getStatus('d-1');
      expect(view.status).toBe(VerificationStatus.PENDING);
      expect(view.submitted).toBe(false);
      expect(view.missing).toEqual([
        DocumentType.LICENSE,
        DocumentType.VEHICLE_REGISTRATION,
        DocumentType.BACKGROUND_CHECK,
        'vehicle_make',
        'vehicle_model',
        'vehicle_plate',
      ]);
      expect(view.documents).toHaveLength(3);
      expect(view.documents.every((d) => d.uploaded === false)).toBe(true);
    });

    it('is empty when all docs + vehicle are present', async () => {
      mockVerification(
        makeVerification({
          documents: [
            draftDoc(DocumentType.LICENSE),
            draftDoc(DocumentType.VEHICLE_REGISTRATION),
            draftDoc(DocumentType.BACKGROUND_CHECK),
          ],
        }),
      );
      const view = await service.getStatus('d-1');
      expect(view.missing).toEqual([]);
      expect(view.vehicle_details_complete).toBe(true);
    });

    it('surfaces rejection fields when REJECTED', async () => {
      mockVerification(
        makeVerification({
          status: VerificationStatus.REJECTED,
          rejectionReasonCode: 'NAME_MISMATCH',
          rejectionMessage: 'Name does not match',
        }),
      );
      const view = await service.getStatus('d-1');
      expect(view.rejection_reason_code).toBe('NAME_MISMATCH');
      expect(view.rejection_message).toBe('Name does not match');
    });
  });

  // ------------------------------------------------------------ upload flow

  describe('requestUploadUrl', () => {
    it('rejects a disallowed content type', async () => {
      mockVerification(makeVerification());
      await expect(
        service.requestUploadUrl('d-1', DocumentType.LICENSE, 'application/zip', 1000),
      ).rejects.toMatchObject({ code: AuthErrorCode.UNSUPPORTED_FILE_TYPE });
    });

    it('rejects an oversized file', async () => {
      mockVerification(makeVerification());
      await expect(
        service.requestUploadUrl('d-1', DocumentType.LICENSE, 'image/jpeg', storage.maxUploadBytes + 1),
      ).rejects.toMatchObject({ code: AuthErrorCode.FILE_TOO_LARGE });
    });

    it('locks edits once APPROVED', async () => {
      mockVerification(makeVerification({ status: VerificationStatus.APPROVED }));
      await expect(
        service.requestUploadUrl('d-1', DocumentType.LICENSE, 'image/jpeg', 1000),
      ).rejects.toMatchObject({ code: AuthErrorCode.ALREADY_APPROVED_LOCKED });
    });

    it('locks edits while a submission is under review (PENDING + submitted)', async () => {
      mockVerification(makeVerification({ submittedAt: new Date() }));
      await expect(
        service.requestUploadUrl('d-1', DocumentType.LICENSE, 'image/jpeg', 1000),
      ).rejects.toMatchObject({ code: AuthErrorCode.ALREADY_APPROVED_LOCKED });
    });

    it('returns a presigned PUT + server-generated key for a draft', async () => {
      mockVerification(makeVerification());
      const res = await service.requestUploadUrl('d-1', DocumentType.LICENSE, 'image/jpeg', 1000);
      expect(res.storage_key).toBe('driver-docs/d-1/uuid-1');
      expect(res.upload_url).toContain('https://storage/put');
      expect(res.expires_in).toBeGreaterThan(0);
    });
  });

  describe('confirmUpload', () => {
    it('rejects a key outside the driver prefix (issuance proof)', async () => {
      mockVerification(makeVerification());
      await expect(
        service.confirmUpload('d-1', DocumentType.LICENSE, 'driver-docs/EVIL/x'),
      ).rejects.toMatchObject({ code: AuthErrorCode.NOT_YOUR_UPLOAD });
    });

    it('rejects when the object is absent in storage', async () => {
      mockVerification(makeVerification());
      storage.head.mockResolvedValue({ exists: false });
      await expect(
        service.confirmUpload('d-1', DocumentType.LICENSE, 'driver-docs/d-1/uuid-1'),
      ).rejects.toMatchObject({ code: AuthErrorCode.UPLOAD_NOT_FOUND });
    });

    it('rejects a content-type/size mismatch re-read from storage', async () => {
      mockVerification(makeVerification());
      storage.head.mockResolvedValue({ exists: true, size: 1234, contentType: 'application/zip' });
      await expect(
        service.confirmUpload('d-1', DocumentType.LICENSE, 'driver-docs/d-1/uuid-1'),
      ).rejects.toMatchObject({ code: AuthErrorCode.FILE_MISMATCH });
    });

    it('stores a draft document (submissionNumber null) on success', async () => {
      mockVerification(makeVerification());
      const rec = await service.confirmUpload('d-1', DocumentType.LICENSE, 'driver-docs/d-1/uuid-1');
      expect(rec.submission_number).toBeNull();
      expect(prisma.driverDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ submissionNumber: null }) }),
      );
    });
  });

  // ----------------------------------------------------------------- submit

  describe('submit', () => {
    it('throws incomplete_submission listing what is missing', async () => {
      mockVerification(makeVerification());
      prisma.driver.findUnique.mockResolvedValue(null);
      await expect(service.submit('d-1')).rejects.toMatchObject({
        code: AuthErrorCode.INCOMPLETE_SUBMISSION,
      });
    });

    it('refuses to resubmit while already queued (PENDING + submitted)', async () => {
      mockVerification(makeVerification({ submittedAt: new Date(), submissionNumber: 1 }));
      await expect(service.submit('d-1')).rejects.toMatchObject({ code: AuthErrorCode.ALREADY_SUBMITTED });
    });

    it('refuses when already APPROVED', async () => {
      mockVerification(makeVerification({ status: VerificationStatus.APPROVED }));
      await expect(service.submit('d-1')).rejects.toMatchObject({ code: AuthErrorCode.ALREADY_APPROVED });
    });

    it('increments submission_number, freezes drafts, and enqueues an outbox row', async () => {
      const docs = [
        draftDoc(DocumentType.LICENSE),
        draftDoc(DocumentType.VEHICLE_REGISTRATION),
        draftDoc(DocumentType.BACKGROUND_CHECK),
      ];
      // submit() reads the draft, then getStatus() re-reads the committed row.
      mockVerification(
        makeVerification({ documents: docs }),
        makeVerification({ documents: docs, submittedAt: new Date(), submissionNumber: 1 }),
      );
      const view = await service.submit('d-1');
      expect(tx.driverVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ submissionNumber: 1, status: VerificationStatus.PENDING }) }),
      );
      expect(tx.driverDocument.updateMany).toHaveBeenCalledWith(
        // #1 fix: stamp the CURRENT doc set by id (not just null drafts) with the new number.
        expect.objectContaining({
          where: { id: { in: expect.arrayContaining(['doc-LICENSE', 'doc-VEHICLE_REGISTRATION', 'doc-BACKGROUND_CHECK']) } },
          data: { submissionNumber: 1 },
        }),
      );
      expect(outbox.enqueue).toHaveBeenCalledWith('driver.onboarding.submitted', expect.objectContaining({ submissionNumber: 1 }), tx);
      expect(view.submitted).toBe(true);
    });
  });

  // ---------------------------------------------------------- admin: review

  describe('approve', () => {
    const input = {
      submissionNumber: 1,
      licenseExpiresOn: new Date('2030-01-01'),
      registrationExpiresOn: new Date('2030-01-01'),
    };

    it('requires a submitted PENDING row (not reviewable otherwise)', async () => {
      mockVerification(makeVerification({ status: VerificationStatus.PENDING, submittedAt: null, submissionNumber: 1 }));
      await expect(service.approve('d-1', 'admin-1', input)).rejects.toMatchObject({ code: AuthErrorCode.NOT_REVIEWABLE });
    });

    it('rejects a stale submission_number before touching storage', async () => {
      mockVerification(makeVerification({ submittedAt: new Date(), submissionNumber: 2 }));
      await expect(service.approve('d-1', 'admin-1', { ...input, submissionNumber: 1 })).rejects.toMatchObject({
        code: AuthErrorCode.STALE_SUBMISSION,
      });
    });

    it('requires license + registration expiry dates', async () => {
      mockVerification(makeVerification({ submittedAt: new Date(), submissionNumber: 1 }));
      await expect(
        service.approve('d-1', 'admin-1', { submissionNumber: 1 }),
      ).rejects.toMatchObject({ code: AuthErrorCode.MISSING_EXPIRY });
    });

    it('loses the concurrency race when compare-and-set updates 0 rows', async () => {
      mockVerification(makeVerification({ submittedAt: new Date(), submissionNumber: 1 }));
      tx.driverVerification.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.approve('d-1', 'admin-1', input)).rejects.toMatchObject({ code: AuthErrorCode.NOT_REVIEWABLE });
      expect(events.emitDriverVerificationChanged).not.toHaveBeenCalled();
    });

    it('wins the race: writes APPROVED + audit + outbox, then emits post-commit', async () => {
      mockVerification(
        makeVerification({ submittedAt: new Date(), submissionNumber: 1 }),
        makeVerification({ status: VerificationStatus.APPROVED, submittedAt: new Date(), submissionNumber: 1 }),
      );
      await service.approve('d-1', 'admin-1', input);
      expect(tx.driverVerification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: VerificationStatus.APPROVED }) }),
      );
      expect(tx.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'approve_onboarding' }) }),
      );
      expect(outbox.enqueue).toHaveBeenCalledWith(
        'driver.verification.changed',
        expect.objectContaining({ to: VerificationStatus.APPROVED }),
        tx,
      );
      expect(events.emitDriverVerificationChanged).toHaveBeenCalledWith(
        expect.objectContaining({ to: VerificationStatus.APPROVED }),
      );
    });

    it('is idempotent: re-approving the same current submission writes no audit/emit (§7)', async () => {
      // status APPROVED + matching submission_number -> short-circuit before any write.
      mockVerification(
        makeVerification({ status: VerificationStatus.APPROVED, submittedAt: new Date(), submissionNumber: 1 }),
      );
      const view = await service.approve('d-1', 'admin-1', input);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.adminAuditLog.create).not.toHaveBeenCalled();
      expect(outbox.enqueue).not.toHaveBeenCalled();
      expect(events.emitDriverVerificationChanged).not.toHaveBeenCalled();
      expect(view.status).toBe(VerificationStatus.APPROVED);
    });
  });

  describe('reject', () => {
    it('stores the reason code + message and emits the transition', async () => {
      mockVerification(
        makeVerification({ submittedAt: new Date(), submissionNumber: 1 }),
        makeVerification({ status: VerificationStatus.REJECTED, submittedAt: new Date(), submissionNumber: 1 }),
      );
      await service.reject('d-1', 'admin-1', { submissionNumber: 1, reasonCode: 'NAME_MISMATCH', message: 'No match' });
      expect(tx.driverVerification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: VerificationStatus.REJECTED, rejectionReasonCode: 'NAME_MISMATCH' }) }),
      );
      expect(events.emitDriverVerificationChanged).toHaveBeenCalledWith(
        expect.objectContaining({ to: VerificationStatus.REJECTED }),
      );
    });
  });

  describe('revoke', () => {
    it('only pulls an APPROVED driver', async () => {
      mockVerification(makeVerification({ status: VerificationStatus.PENDING, submittedAt: new Date(), submissionNumber: 1 }));
      await expect(
        service.revoke('d-1', 'admin-1', { reasonCode: 'INVALID_DOCUMENT', message: 'forged' }),
      ).rejects.toMatchObject({ code: AuthErrorCode.NOT_REVIEWABLE });
    });

    it('moves APPROVED -> REJECTED with audit + outbox + emit', async () => {
      mockVerification(
        makeVerification({ status: VerificationStatus.APPROVED, submittedAt: new Date(), submissionNumber: 1 }),
        makeVerification({ status: VerificationStatus.REJECTED, submittedAt: new Date(), submissionNumber: 1 }),
      );
      await service.revoke('d-1', 'admin-1', { reasonCode: 'INVALID_DOCUMENT', message: 'forged' });
      expect(tx.adminAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'revoke_onboarding' }) }),
      );
      expect(events.emitDriverVerificationChanged).toHaveBeenCalledWith(
        expect.objectContaining({ from: VerificationStatus.APPROVED, to: VerificationStatus.REJECTED }),
      );
    });
  });

  // -------------------------------------------------- vehicle-change re-review

  describe('onVehicleChanged', () => {
    it('resets an APPROVED driver to a PENDING draft and emits', async () => {
      mockVerification(makeVerification({ status: VerificationStatus.APPROVED, submittedAt: new Date(), submissionNumber: 3 }));
      await service.onVehicleChanged({ driverId: 'd-1' });
      expect(tx.driverVerification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: VerificationStatus.PENDING, submittedAt: null }) }),
      );
      expect(outbox.enqueue).toHaveBeenCalledWith(
        'driver.verification.changed',
        expect.objectContaining({ to: VerificationStatus.PENDING }),
        tx,
      );
      expect(events.emitDriverVerificationChanged).toHaveBeenCalled();
    });

    it('is a no-op when not APPROVED', async () => {
      mockVerification(makeVerification({ status: VerificationStatus.PENDING }));
      await service.onVehicleChanged({ driverId: 'd-1' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(events.emitDriverVerificationChanged).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------- per-driver limits

  describe('rate limits (§10)', () => {
    it('429 on upload-url once the driver budget is exhausted', async () => {
      rateLimiter.consume.mockResolvedValue({ allowed: false, retryAfterSeconds: 120 });
      await expect(
        service.requestUploadUrl('d-1', DocumentType.LICENSE, 'image/jpeg', 1000),
      ).rejects.toMatchObject({ code: AuthErrorCode.RATE_LIMITED, retryAfterSeconds: 120 });
      // Never reaches storage / state when throttled.
      expect(storage.presignPut).not.toHaveBeenCalled();
    });

    it('429 on submit once the driver budget is exhausted', async () => {
      rateLimiter.consume.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 });
      await expect(service.submit('d-1')).rejects.toMatchObject({ code: AuthErrorCode.RATE_LIMITED });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('keys the bucket by driver id so one driver cannot exhaust another budget', async () => {
      mockVerification(makeVerification());
      await service.requestUploadUrl('d-1', DocumentType.LICENSE, 'image/jpeg', 1000);
      expect(rateLimiter.consume).toHaveBeenCalledWith(expect.stringContaining(':d-1'), expect.any(Number), expect.any(Number));
    });
  });

  // -------------------------------------------------------------- error shape

  it('incomplete_submission carries the AuthError type', async () => {
    mockVerification(makeVerification());
    prisma.driver.findUnique.mockResolvedValue(null);
    await expect(service.submit('d-1')).rejects.toBeInstanceOf(AuthError);
  });
});
