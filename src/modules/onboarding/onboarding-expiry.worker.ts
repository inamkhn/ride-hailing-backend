import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DocumentType, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { DRIVER_VERIFICATION_CHANGED, EventBus } from '../../common/events/event-bus';

/**
 * Scheduled document-expiry auto-revoke (onboarding-module.md §10, resolved decision).
 * Daily: any APPROVED driver whose CURRENT license or vehicle registration has an
 * `expires_on` in the past is moved to REJECTED. The change commits with an outbox
 * row and fires `driver.verification.changed`, so Location/Dispatch take the driver
 * offline (§8.2) and Notification tells them to renew. A concurrent admin decision
 * wins because we re-check `status = APPROVED` in the update.
 */
@Injectable()
export class OnboardingExpiryWorker {
  private readonly logger = new Logger(OnboardingExpiryWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly events: EventBus,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async revokeExpiredDocuments(): Promise<number> {
    const now = new Date();
    const approved = await this.prisma.driverVerification.findMany({
      where: { status: VerificationStatus.APPROVED },
      include: { documents: true },
    });

    let revoked = 0;
    for (const v of approved) {
      if (!this.hasExpiredCurrentDoc(v.documents, now)) continue;

      const didRevoke = await this.prisma.$transaction(async (tx) => {
        const res = await tx.driverVerification.updateMany({
          where: { driverId: v.driverId, status: VerificationStatus.APPROVED },
          data: {
            status: VerificationStatus.REJECTED,
            rejectionReasonCode: 'DOCUMENT_EXPIRED',
            rejectionMessage: 'Your driving documents have expired. Please upload renewed copies to resume work.',
            reviewedAt: now,
          },
        });
        if (res.count !== 1) return false; // a human admin decided concurrently — they win
        await this.outbox.enqueue(
          DRIVER_VERIFICATION_CHANGED,
          { driverId: v.driverId, from: VerificationStatus.APPROVED, to: VerificationStatus.REJECTED, submissionNumber: v.submissionNumber },
          tx,
        );
        return true;
      });

      if (didRevoke) {
        revoked++;
        this.events.emitDriverVerificationChanged({
          driverId: v.driverId,
          from: VerificationStatus.APPROVED,
          to: VerificationStatus.REJECTED,
          submissionNumber: v.submissionNumber,
        });
      }
    }

    if (revoked > 0) this.logger.log(`Expired-document auto-revoke: ${revoked} driver(s) moved to REJECTED`);
    return revoked;
  }

  /** Latest upload per type; APPROVED means both license + registration were current at approval. */
  private hasExpiredCurrentDoc(
    docs: { type: DocumentType; uploadedAt: Date; expiresOn: Date | null }[],
    now: Date,
  ): boolean {
    const latest = new Map<DocumentType, { uploadedAt: Date; expiresOn: Date | null }>();
    for (const d of docs) {
      const prev = latest.get(d.type);
      if (!prev || d.uploadedAt > prev.uploadedAt) latest.set(d.type, d);
    }
    for (const type of [DocumentType.LICENSE, DocumentType.VEHICLE_REGISTRATION]) {
      const doc = latest.get(type);
      if (doc?.expiresOn && doc.expiresOn < now) return true;
    }
    return false;
  }
}
