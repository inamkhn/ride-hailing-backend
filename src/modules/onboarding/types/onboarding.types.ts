import { DocumentType, VerificationStatus } from '@prisma/client';

/** Required document set at MVP (§12 item 7 assumption): all three must exist to submit. */
export const REQUIRED_DOC_TYPES: DocumentType[] = [
  DocumentType.LICENSE,
  DocumentType.VEHICLE_REGISTRATION,
  DocumentType.BACKGROUND_CHECK,
];

/** Accepted uploads (§9 starting values): JPEG/PNG/PDF. HEIC is converted client-side. */
export const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

/** Admin reject/revoke reason codes (§6.4). OTHER requires a message (enforced in DTO). */
export const REJECTION_REASON_CODES = [
  'UNREADABLE_IMAGE',
  'DOCUMENT_EXPIRED',
  'NAME_MISMATCH',
  'VEHICLE_MISMATCH',
  'INVALID_DOCUMENT',
  'OTHER',
] as const;
export type RejectionReasonCode = (typeof REJECTION_REASON_CODES)[number];

/** GET /v1/onboarding/status (§5.1). */
export interface StatusView {
  status: VerificationStatus;
  submitted: boolean;
  submission_number: number;
  documents: { type: DocumentType; uploaded: boolean; uploaded_at: string | null }[];
  vehicle_details_complete: boolean;
  missing: string[];
  rejection_reason_code?: string | null;
  rejection_message?: string | null;
}

/** POST /documents/upload-url (§5.2). */
export interface UploadUrlResponse {
  upload_url: string;
  storage_key: string;
  expires_in: number;
}

/** POST /documents confirm (§5.3) — the stored document record, never a public URL. */
export interface DocumentRecord {
  id: string;
  type: DocumentType;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
  submission_number: number | null;
}

/** Admin decision inputs (mapped from snake_case DTOs by the controller). */
export interface ApproveInput {
  submissionNumber: number;
  licenseExpiresOn?: Date;
  registrationExpiresOn?: Date;
  backgroundCheckExpiresOn?: Date;
  note?: string;
}
export interface RejectInput {
  submissionNumber: number;
  reasonCode: RejectionReasonCode;
  message: string;
}
export interface RevokeInput {
  reasonCode: RejectionReasonCode;
  message: string;
}
