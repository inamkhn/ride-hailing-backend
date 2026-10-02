import { Injectable, OnModuleInit } from '@nestjs/common';
import { User } from '@prisma/client';
import { argon2id, hash, verify } from 'argon2';
import { AuthError } from '../../common/errors/auth-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RateLimitService } from '../../common/rate-limiting/rate-limit.service';
import { DeviceInfo, TokenResponse } from './types/auth.types';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';

/** argon2id params (§8.5 slow hash). OWASP-ish baseline; tunable. */
const ARGON2_OPTIONS = {
  type: argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

/**
 * Admin email/password auth (§4). Enforces: constant-time password check with a
 * dummy hash for unknown emails (no account-enumeration timing leak), escalating
 * lockout, is_active gate, optional TOTP, and an admin_audit_log row for every
 * attributable auth event. Admin identity always comes from the JWT `sub` (§4.2).
 */
@Injectable()
export class AdminAuthService implements OnModuleInit {
  /** Precomputed hash used to equalize timing when the email doesn't exist. */
  private dummyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly totp: TotpService,
    private readonly rateLimiter: RateLimitService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash('timing-equalization-placeholder', ARGON2_OPTIONS);
  }

  /** POST /v1/auth/admin/login (§4.1). Throws a single generic error for all bad-credential cases. */
  async login(
    email: string,
    password: string,
    totpCode: string | undefined,
    clientIp?: string,
  ): Promise<TokenResponse> {
    // Lockout per email (+ IP via throttler globally) with escalating backoff.
    const emailLimit = await this.rateLimiter.consume(`admin:login:email:${email}`, 5, 900);
    const ipLimit = clientIp
      ? await this.rateLimiter.consume(`admin:login:ip:${clientIp}`, 10, 900)
      : { allowed: true as const };
    if (!emailLimit.allowed) throw AuthError.rateLimited(emailLimit.retryAfterSeconds);
    if (!ipLimit.allowed) throw AuthError.rateLimited(ipLimit.retryAfterSeconds);

    const admin = await this.prisma.user.findFirst({
      where: { email, role: 'admin' },
    });

    // Unknown email: run a dummy verify so response time doesn't reveal existence,
    // then a generic 401. Not attributable to an admin, so no audit row (§4.1).
    if (!admin?.passwordHash) {
      await verify(this.dummyHash, password).catch(() => undefined);
      throw AuthError.invalidCredentials();
    }

    const passwordOk = await verify(admin.passwordHash, password).catch(() => false);
    if (!passwordOk) {
      await this.audit(admin.id, 'admin_login_failed', 'invalid password');
      throw AuthError.invalidCredentials();
    }

    if (!admin.isActive) {
      await this.audit(admin.id, 'admin_login_blocked', 'account deactivated');
      throw AuthError.accountDeactivated();
    }

    // Second factor, only when enrolled (§4.1: TOTP optional).
    if (admin.totpEnabled) {
      if (!totpCode || !admin.totpSecret || !this.totp.verify(totpCode, admin.totpSecret)) {
        await this.audit(admin.id, 'admin_login_failed', 'totp missing/invalid');
        throw AuthError.invalidCredentials('Invalid credentials or second factor');
      }
    }

    await this.audit(admin.id, 'admin_login', null);
    return this.buildTokenResponse(admin);
  }

  /**
   * POST /v1/auth/admin/change-password (§4.2). Acting admin is the JWT `sub`,
   * never a body field. Re-verifies current password, enforces strength, then
   * revokes every other session so a stolen token dies with the old password.
   */
  async changePassword(
    adminId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const admin = await this.prisma.user.findFirst({
      where: { id: adminId, role: 'admin' },
    });
    if (!admin?.passwordHash) throw AuthError.invalidCredentials();

    const currentOk = await verify(admin.passwordHash, currentPassword).catch(() => false);
    if (!currentOk) {
      await this.audit(admin.id, 'admin_password_change_failed', 'wrong current password');
      throw AuthError.invalidCredentials();
    }

    this.assertStrongPassword(newPassword);
    const newHash = await hash(newPassword, ARGON2_OPTIONS);

    // Update + audit in one transaction so the log can't drift from the change.
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: admin.id }, data: { passwordHash: newHash } }),
      this.prisma.adminAuditLog.create({
        data: {
          adminId: admin.id,
          action: 'admin_password_change',
          targetType: 'user',
          targetId: admin.id,
        },
      }),
    ]);

    // Kill all refresh sessions for this admin (§4.2 rule).
    await this.refreshTokens.revokeAllForUser(admin.id);
  }

  /** Shared token issuance for admin logins (shorter TTLs handled inside TokenService). */
  private async buildTokenResponse(admin: User): Promise<TokenResponse> {
    const access = this.tokens.createAccessToken(admin.id, admin.role);
    const device: DeviceInfo = {}; // admin backoffice is web; device fields optional
    const refresh = await this.refreshTokens.issueNewFamily(admin.id, admin.role, device);
    return {
      access_token: access.token,
      access_expires_in: access.expiresInSeconds,
      refresh_token: refresh.rawToken,
      refresh_expires_in: refresh.expiresInSeconds,
      user: { id: admin.id, role: admin.role },
    };
  }

  private assertStrongPassword(pw: string): void {
    // §8.5 min length/strength. MVP rule: >=12 chars, at least one letter + one digit.
    const ok =
      pw.length >= 12 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
    if (!ok) throw AuthError.weakPassword();
  }

  private async audit(
    adminId: string,
    action: string,
    reason: string | null,
  ): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        adminId,
        action,
        targetType: 'user',
        targetId: adminId,
        reason: reason ?? undefined,
      },
    });
  }
}
