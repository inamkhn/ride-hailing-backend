import { AuthErrorCode, AUTH_ERROR_STATUS } from './auth-error-codes';

/**
 * Typed auth failure carrying a machine-readable code (§8.6) and optional
 * retry_after_seconds (§2.4, present on 429 + lockouts). The global exception
 * filter turns these into the standard error envelope.
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(
    code: AuthErrorCode,
    message: string,
    options?: { retryAfterSeconds?: number },
  ) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = AUTH_ERROR_STATUS[code];
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }

  static invalidPhone(message = 'Phone number is invalid'): AuthError {
    return new AuthError(AuthErrorCode.INVALID_PHONE, message);
  }
  static unsupportedCountry(message = 'This country is not supported'): AuthError {
    return new AuthError(AuthErrorCode.UNSUPPORTED_COUNTRY, message);
  }
  static weakPassword(message = 'Password does not meet strength requirements'): AuthError {
    return new AuthError(AuthErrorCode.WEAK_PASSWORD, message);
  }
  static invalidCode(message = 'Verification code is incorrect or expired'): AuthError {
    return new AuthError(AuthErrorCode.INVALID_CODE, message);
  }
  static invalidCredentials(
    message = 'Invalid email or password',
  ): AuthError {
    return new AuthError(AuthErrorCode.INVALID_CREDENTIALS, message);
  }
  static tokenExpired(message = 'Access token expired'): AuthError {
    return new AuthError(AuthErrorCode.TOKEN_EXPIRED, message);
  }
  static tokenInvalid(message = 'Access token invalid'): AuthError {
    return new AuthError(AuthErrorCode.TOKEN_INVALID, message);
  }
  static refreshRevoked(message = 'Refresh token revoked or reused'): AuthError {
    return new AuthError(AuthErrorCode.REFRESH_REVOKED, message);
  }
  static forbiddenRole(message = 'Role not permitted for this action'): AuthError {
    return new AuthError(AuthErrorCode.FORBIDDEN_ROLE, message);
  }
  static accountDeactivated(message = 'Account is deactivated'): AuthError {
    return new AuthError(AuthErrorCode.ACCOUNT_DEACTIVATED, message);
  }
  static roleMismatch(message = 'This phone belongs to a different account type'): AuthError {
    return new AuthError(AuthErrorCode.ROLE_MISMATCH, message);
  }
  static rateLimited(retryAfterSeconds?: number): AuthError {
    return new AuthError(AuthErrorCode.RATE_LIMITED, 'Too many requests', {
      retryAfterSeconds,
    });
  }
  static otpProviderUnavailable(
    message = 'OTP provider unavailable, try again shortly',
  ): AuthError {
    return new AuthError(AuthErrorCode.OTP_PROVIDER_UNAVAILABLE, message);
  }
}
