import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Twilio from 'twilio';
import { AuthError } from '../../common/errors/auth-error';
import { maskPhone } from './utils/phone.util';

/**
 * Thin wrapper over Twilio Verify v2 (§Auth confirmed: Phone OTP via Twilio Verify).
 * No OTP code is ever stored or logged locally (§3.1 "Must not"). If the provider
 * errors we surface a single 503 otp_provider_unavailable (§8.6).
 *
 * Test bypass (§8.8): when OTP_TEST_BYPASS=true (never in production, enforced in
 * env validation), send is a no-op and check accepts the fixed OTP_TEST_CODE.
 */
@Injectable()
export class TwilioVerifyService {
  private readonly logger = new Logger(TwilioVerifyService.name);
  private readonly serviceSid: string;
  private readonly client: Twilio.Twilio | null;
  private readonly bypass: boolean;
  private readonly testCode: string | undefined;

  constructor(config: ConfigService) {
    this.serviceSid = config.get<string>('TWILIO_VERIFY_SERVICE_SID', '');
    const sid = config.get<string>('TWILIO_ACCOUNT_SID', '');
    const token = config.get<string>('TWILIO_AUTH_TOKEN', '');
    this.client = sid && token ? Twilio(sid, token) : null;
    this.bypass = config.get<string>('OTP_TEST_BYPASS') === 'true';
    this.testCode = config.get<string>('OTP_TEST_CODE');
  }

  /** Ask Twilio to SMS a code to the E.164 number. */
  async sendCode(phoneE164: string): Promise<void> {
    if (this.bypass) {
      this.logger.warn(`OTP bypass active — skipped send to ${maskPhone(phoneE164)}`);
      return;
    }
    if (!this.client || !this.serviceSid) {
      this.logger.error('Twilio client/service SID not configured');
      throw AuthError.otpProviderUnavailable();
    }
    try {
      await this.client.verify.v2
        .services(this.serviceSid)
        .verifications.create({ to: phoneE164, channel: 'sms' });
    } catch (err) {
      // Never log the code or full number; provider errors are masked.
      this.logger.error(`Twilio send failed for ${maskPhone(phoneE164)}`);
      throw AuthError.otpProviderUnavailable();
    }
  }

  /** Returns true when the code is valid. False (not an error) means wrong/expired. */
  async checkCode(phoneE164: string, code: string): Promise<boolean> {
    if (this.bypass) {
      return !!this.testCode && code === this.testCode;
    }
    if (!this.client || !this.serviceSid) {
      this.logger.error('Twilio client/service SID not configured');
      throw AuthError.otpProviderUnavailable();
    }
    try {
      const check = await this.client.verify.v2
        .services(this.serviceSid)
        .verificationChecks.create({ to: phoneE164, code });
      return check.status === 'approved';
    } catch (err) {
      // A validation error from Twilio (e.g. malformed) is "not approved", not a
      // provider outage; only true outages map to 503 via the message below.
      const status = (err as { status?: number })?.status;
      if (status && status >= 500) {
        this.logger.error(`Twilio check outage for ${maskPhone(phoneE164)}`);
        throw AuthError.otpProviderUnavailable();
      }
      return false;
    }
  }
}
