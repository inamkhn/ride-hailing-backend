import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';

/**
 * Admin TOTP second factor (auth-api-spec §4.1, §8.5). Optional at login: enforced
 * only for admins with totpEnabled. Secrets are generated at enrollment (CLI/backoffice)
 * and stored encrypted-at-rest on users.totp_secret; enrollment/QR is out of the
 * request path for MVP, so this service just issues + verifies.
 */
@Injectable()
export class TotpService {
  private readonly issuer: string;

  constructor(config: ConfigService) {
    this.issuer = config.get<string>('TOTP_ISSUER', 'RideHailing Backoffice');
    // Standard 6-digit / 30s / SHA-1, matching Google Authenticator & the otplib default.
    authenticator.options = { step: 30, window: 1, digits: 6 };
  }

  /** New base32 secret for enrollment. */
  generateSecret(): string {
    return authenticator.generateSecret();
  }

  /** otpauth:// URI to render as a QR in the authenticator app. */
  provisioningUri(accountName: string, secret: string): string {
    return authenticator.keyuri(accountName, this.issuer, secret);
  }

  /** Constant-time-ish verify with ±1 step clock drift tolerance (window:1 above). */
  verify(token: string, secret: string): boolean {
    try {
      return authenticator.verify({ token, secret });
    } catch {
      return false;
    }
  }
}
