import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role, User } from '@prisma/client';
import { AuthError } from '../../common/errors/auth-error';
import { RateLimitService } from '../../common/rate-limiting/rate-limit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DeviceInfo, OtpVerifyResponse, TokenResponse } from './types/auth.types';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';
import { TwilioVerifyService } from './twilio-verify.service';
import { isCountryAllowed, normalizePhone } from './utils/phone.util';

/** §3.2 optional device input, normalized. */
export interface VerifyInput extends DeviceInfo {
  phoneNumber: string;
  code: string;
}

/**
 * Shared rider/driver OTP logic (§2.2, §3). Controllers are thin and only differ by
 * the role they pass + the driver-only side effect. Rate limits, Twilio calls,
 * user creation and token issuing all live here, once.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly allowlist: string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly twilio: TwilioVerifyService,
    private readonly rateLimiter: RateLimitService,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
    config: ConfigService,
  ) {
    this.allowlist = (config.get<string>('OTP_ALLOWED_COUNTRIES', '') ?? '')
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
  }

  /** POST /v1/auth/{rider|driver}/otp/request (§3.1). Returns nothing; controller sends 202. */
  async requestOtp(
    role: Role,
    rawPhone: string,
    deviceId?: string,
    clientIp?: string,
  ): Promise<void> {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw AuthError.invalidPhone();
    if (!isCountryAllowed(phone.region, this.allowlist)) {
      throw AuthError.unsupportedCountry();
    }

    // Abuse/cost controls (§8.1). Counters live in Redis; no DB writes here.
    await this.enforceRequestLimits(phone.e164, deviceId, clientIp);

    await this.twilio.sendCode(phone.e164);
    // 202 parity: identical response whether or not the number is registered (§10).
    void role; // role is implicit from the route; never read from the body (§2.1)
  }

  /** POST /v1/auth/{rider|driver}/otp/verify (§3.2). Executes steps 1–8 in order. */
  async verifyOtp(role: Role, input: VerifyInput): Promise<OtpVerifyResponse> {
    // 1. Normalize + verify-attempt limit.
    const phone = normalizePhone(input.phoneNumber);
    if (!phone) throw AuthError.invalidPhone();
    const attempt = await this.rateLimiter.consume(`otp:verify:${phone.e164}`, 5, 600);
    if (!attempt.allowed) throw AuthError.rateLimited(attempt.retryAfterSeconds);

    // 2. Twilio check.
    const ok = await this.twilio.checkCode(phone.e164, input.code);
    if (!ok) throw AuthError.invalidCode();

    // 3. Look up by phone.
    let user = await this.prisma.user.findUnique({
      where: { phoneNumber: phone.e164 },
    });
    let isNewUser = false;

    if (!user) {
      // 4. Implicit sign-up (driver also gets a PENDING verification row, same txn).
      const outcome = await this.createUser(role, phone.e164);
      user = outcome.user;
      isNewUser = outcome.created;
    }

    // 5. Role mismatch — never create a second account (§2.1, single-role).
    if (user.role !== role) throw AuthError.roleMismatch();
    // 6. Deactivated — no tokens.
    if (!user.isActive) throw AuthError.accountDeactivated();

    // 7 + 8. Issue tokens, record device on the refresh token.
    const base = await this.buildTokenResponse(user, {
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      platform: input.platform,
    });
    return { ...base, is_new_user: isNewUser };
  }

  /**
   * Create a user; for drivers, insert the PENDING driver_verifications row in the
   * SAME transaction (features doc: onboarding row created with the users row).
   * Concurrent first-verifies collide on the phone unique constraint — the loser
   * re-reads the winner's row and logs in normally instead of erroring (§3.2 edge).
   */
  private async createUser(
    role: Role,
    e164: string,
  ): Promise<{ user: User; created: boolean }> {
    try {
      if (role === Role.driver) {
        const user = await this.prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: { phoneNumber: e164, role: Role.driver },
          });
          await tx.driverVerification.create({
            data: { driverId: created.id, status: 'PENDING' },
          });
          return created;
        });
        return { user, created: true };
      }
      const user = await this.prisma.user.create({
        data: { phoneNumber: e164, role },
      });
      return { user, created: true };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Lost the race — re-read the winner's row.
        const existing = await this.prisma.user.findUnique({
          where: { phoneNumber: e164 },
        });
        if (existing) return { user: existing, created: false };
      }
      // Any other failure: do NOT issue tokens without a committed user (§3.2 edge).
      this.logger.error('User creation failed during OTP verify');
      throw err;
    }
  }

  /** Assemble the standard token response (§2.3). Shared with admin login. */
  async buildTokenResponse(user: User, device: DeviceInfo): Promise<TokenResponse> {
    const access = this.tokens.createAccessToken(user.id, user.role);
    const refresh = await this.refreshTokens.issueNewFamily(user.id, user.role, device);
    return {
      access_token: access.token,
      access_expires_in: access.expiresInSeconds,
      refresh_token: refresh.rawToken,
      refresh_expires_in: refresh.expiresInSeconds,
      user: { id: user.id, role: user.role },
    };
  }

  private async enforceRequestLimits(
    e164: string,
    deviceId?: string,
    clientIp?: string,
  ): Promise<void> {
    const checks: Array<Promise<{ allowed: boolean; retryAfterSeconds?: number }>> = [
      this.rateLimiter.consume(`otp:req:phone:${e164}`, 3, 600), // 3 / 10 min
      this.rateLimiter.consume(`otp:req:phone:day:${e164}`, 10, 86400), // 10 / day
    ];
    if (clientIp) checks.push(this.rateLimiter.consume(`otp:req:ip:${clientIp}`, 20, 3600));
    if (deviceId) checks.push(this.rateLimiter.consume(`otp:req:dev:${deviceId}`, 5, 3600));

    const results = await Promise.all(checks);
    const blocked = results.find((r) => !r.allowed);
    if (blocked) throw AuthError.rateLimited(blocked.retryAfterSeconds);

    // All window budgets passed -> apply escalating resend cooldown (§8.1).
    const cooldown = await this.rateLimiter.enforceResendCooldown(e164);
    if (!cooldown.allowed) throw AuthError.rateLimited(cooldown.retryAfterSeconds);
  }
}
