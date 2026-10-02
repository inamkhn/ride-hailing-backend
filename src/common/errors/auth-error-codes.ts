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
};
