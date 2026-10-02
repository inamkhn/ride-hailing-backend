import { HttpStatus } from '@nestjs/common';

/**
 * Machine-readable error codes (auth-api-spec §8.6). The mobile apps switch on these,
 * never on the human-readable message. Each maps to a fixed HTTP status.
 */
export enum AuthErrorCode {
  INVALID_PHONE = 'invalid_phone',
  UNSUPPORTED_COUNTRY = 'unsupported_country',
  WEAK_PASSWORD = 'weak_password',

  INVALID_CODE = 'invalid_code',
  INVALID_CREDENTIALS = 'invalid_credentials',
  TOKEN_EXPIRED = 'token_expired',
  TOKEN_INVALID = 'token_invalid',
  REFRESH_REVOKED = 'refresh_revoked',

  FORBIDDEN_ROLE = 'forbidden_role',
  ACCOUNT_DEACTIVATED = 'account_deactivated',

  ROLE_MISMATCH = 'role_mismatch',

  RATE_LIMITED = 'rate_limited',

  OTP_PROVIDER_UNAVAILABLE = 'otp_provider_unavailable',

  // Onboarding / document-upload codes (onboarding-module.md §5, §6, §7).
  UNSUPPORTED_FILE_TYPE = 'unsupported_file_type',
  FILE_TOO_LARGE = 'file_too_large',
  UPLOAD_NOT_FOUND = 'upload_not_found',
  FILE_MISMATCH = 'file_mismatch',
  NOT_YOUR_UPLOAD = 'not_your_upload',
  INCOMPLETE_SUBMISSION = 'incomplete_submission',
  ALREADY_SUBMITTED = 'already_submitted',
  ALREADY_APPROVED = 'already_approved',
  ALREADY_APPROVED_LOCKED = 'already_approved_locked',
  STALE_SUBMISSION = 'stale_submission',
  NOT_REVIEWABLE = 'not_reviewable',
  MISSING_EXPIRY = 'missing_expiry',
  DOCUMENT_EXPIRED = 'document_expired',
}

/** Code → HTTP status, per §8.6. */
export const AUTH_ERROR_STATUS: Record<AuthErrorCode, HttpStatus> = {
  [AuthErrorCode.INVALID_PHONE]: HttpStatus.BAD_REQUEST,
  [AuthErrorCode.UNSUPPORTED_COUNTRY]: HttpStatus.BAD_REQUEST,
  [AuthErrorCode.WEAK_PASSWORD]: HttpStatus.BAD_REQUEST,
  [AuthErrorCode.INVALID_CODE]: HttpStatus.UNAUTHORIZED,
  [AuthErrorCode.INVALID_CREDENTIALS]: HttpStatus.UNAUTHORIZED,
  [AuthErrorCode.TOKEN_EXPIRED]: HttpStatus.UNAUTHORIZED,
  [AuthErrorCode.TOKEN_INVALID]: HttpStatus.UNAUTHORIZED,
  [AuthErrorCode.REFRESH_REVOKED]: HttpStatus.UNAUTHORIZED,
  [AuthErrorCode.FORBIDDEN_ROLE]: HttpStatus.FORBIDDEN,
  [AuthErrorCode.ACCOUNT_DEACTIVATED]: HttpStatus.FORBIDDEN,
  [AuthErrorCode.ROLE_MISMATCH]: HttpStatus.CONFLICT,
  [AuthErrorCode.RATE_LIMITED]: HttpStatus.TOO_MANY_REQUESTS,
  [AuthErrorCode.OTP_PROVIDER_UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,

  [AuthErrorCode.UNSUPPORTED_FILE_TYPE]: HttpStatus.BAD_REQUEST,
  [AuthErrorCode.FILE_TOO_LARGE]: HttpStatus.BAD_REQUEST,
  [AuthErrorCode.UPLOAD_NOT_FOUND]: HttpStatus.BAD_REQUEST,
  [AuthErrorCode.FILE_MISMATCH]: HttpStatus.BAD_REQUEST,
  [AuthErrorCode.MISSING_EXPIRY]: HttpStatus.BAD_REQUEST,
  [AuthErrorCode.NOT_YOUR_UPLOAD]: HttpStatus.FORBIDDEN,
  [AuthErrorCode.INCOMPLETE_SUBMISSION]: HttpStatus.CONFLICT,
  [AuthErrorCode.ALREADY_SUBMITTED]: HttpStatus.CONFLICT,
  [AuthErrorCode.ALREADY_APPROVED]: HttpStatus.CONFLICT,
  [AuthErrorCode.ALREADY_APPROVED_LOCKED]: HttpStatus.CONFLICT,
  [AuthErrorCode.STALE_SUBMISSION]: HttpStatus.CONFLICT,
  [AuthErrorCode.NOT_REVIEWABLE]: HttpStatus.CONFLICT,
  [AuthErrorCode.DOCUMENT_EXPIRED]: HttpStatus.CONFLICT,
};
