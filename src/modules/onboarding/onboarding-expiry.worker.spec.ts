import { DocumentType, VerificationStatus } from '@prisma/client';
import { OnboardingExpiryWorker } from './onboarding-expiry.worker';

/**
 * Verifies the daily auto-revoke: an APPROVED driver whose CURRENT license or
 * registration is past expires_on moves to REJECTED (commit + outbox + emit); a
 * concurrent human decision (compare-and-set updates 0 rows) is left alone; and a
 * still-valid driver is untouched. The clock is faked so "expired" is deterministic.
 */
describe('OnboardingExpiryWorker', () => {
  const NOW = new Date('2024-06-01T00:00:00Z');

  let prisma: any;
  let outbox: any;
  let events: any;
  let tx: any;
  let worker: OnboardingExpiryWorker;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    tx = { driverVerification: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    prisma = {
      $transaction: jest.fn((cb: any) => cb(tx)),
      driverVerification: { findMany: jest.fn().mockResolvedValue([]) },
    };
    outbox = { enqueue: jest.fn(async () => ({})) };
    events = { emitDriverVerificationChanged: jest.fn() };
    worker = new OnboardingExpiryWorker(prisma, outbox, events);
  });

  afterEach(() => jest.useRealTimers());

  function doc(type: DocumentType, expiresOn: Date | null, uploadedAt = new Date('2024-01-01T00:00:00Z')) {
    return { type, expiresOn, uploadedAt };
  }

  it('revokes an APPROVED driver whose current license has expired', async () => {
    prisma.driverVerification.findMany.mockResolvedValue([
      {
        driverId: 'd-1',
        submissionNumber: 2,
        status: VerificationStatus.APPROVED,
        documents: [doc(DocumentType.LICENSE, new Date('2024-05-01T00:00:00Z'))],
      },
    ]);
    const count = await worker.revokeExpiredDocuments();
    expect(count).toBe(1);
    expect(tx.driverVerification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ driverId: 'd-1', status: VerificationStatus.APPROVED }),
        data: expect.objectContaining({ status: VerificationStatus.REJECTED, rejectionReasonCode: 'DOCUMENT_EXPIRED' }),
      }),
    );
    expect(outbox.enqueue).toHaveBeenCalledWith(
      'driver.verification.changed',
      expect.objectContaining({ to: VerificationStatus.REJECTED }),
      tx,
    );
    expect(events.emitDriverVerificationChanged).toHaveBeenCalledWith(expect.objectContaining({ driverId: 'd-1' }));
  });

  it('leaves a still-valid driver untouched (no revoke, no event)', async () => {
    prisma.driverVerification.findMany.mockResolvedValue([
      {
        driverId: 'd-2',
        submissionNumber: 1,
        status: VerificationStatus.APPROVED,
        documents: [
          doc(DocumentType.LICENSE, new Date('2025-01-01T00:00:00Z')),
          doc(DocumentType.VEHICLE_REGISTRATION, new Date('2025-01-01T00:00:00Z')),
        ],
      },
    ]);
    await expect(worker.revokeExpiredDocuments()).resolves.toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(events.emitDriverVerificationChanged).not.toHaveBeenCalled();
  });

  it('does not revoke when a human decided concurrently (compare-and-set matched 0 rows)', async () => {
    prisma.driverVerification.findMany.mockResolvedValue([
      {
        driverId: 'd-3',
        submissionNumber: 1,
        status: VerificationStatus.APPROVED,
        documents: [doc(DocumentType.LICENSE, new Date('2024-05-01T00:00:00Z'))],
      },
    ]);
    tx.driverVerification.updateMany.mockResolvedValue({ count: 0 });
    await expect(worker.revokeExpiredDocuments()).resolves.toBe(0);
    expect(outbox.enqueue).not.toHaveBeenCalled();
    expect(events.emitDriverVerificationChanged).not.toHaveBeenCalled();
  });

  it('uses the latest upload per type — a renewed (current) doc keeps the driver live', async () => {
    prisma.driverVerification.findMany.mockResolvedValue([
      {
        driverId: 'd-4',
        submissionNumber: 3,
        status: VerificationStatus.APPROVED,
        documents: [
          doc(DocumentType.LICENSE, new Date('2024-01-01T00:00:00Z'), new Date('2023-01-01T00:00:00Z')), // old, expired
          doc(DocumentType.LICENSE, new Date('2025-06-01T00:00:00Z'), new Date('2024-02-01T00:00:00Z')), // newest, valid
        ],
      },
    ]);
    await expect(worker.revokeExpiredDocuments()).resolves.toBe(0);
  });

  it('ignores docs with no expiry set (never auto-revokes on null expires_on)', async () => {
    prisma.driverVerification.findMany.mockResolvedValue([
      {
        driverId: 'd-5',
        submissionNumber: 1,
        status: VerificationStatus.APPROVED,
        documents: [doc(DocumentType.LICENSE, null)],
      },
    ]);
    await expect(worker.revokeExpiredDocuments()).resolves.toBe(0);
  });
});
