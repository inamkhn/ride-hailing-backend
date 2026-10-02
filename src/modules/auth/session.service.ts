import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthError } from '../../common/errors/auth-error';
import { MeResponse, TokenResponse } from './types/auth.types';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';

/**
 * Session lifecycle (§5): refresh rotates the family, logout/logut-all revoke,
 * /me is a live identity + account-state check. Nothing here trusts the token
 * for mutable state — verification_status is read from the DB (§5.4).
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  /** POST /v1/auth/refresh (§5.1). */
  async refresh(rawRefreshToken: string): Promise<TokenResponse> {
    const { userId, role, issued } = await this.refreshTokens.rotate(rawRefreshToken);
    const access = this.tokens.createAccessToken(userId, role);
    return {
      access_token: access.token,
      access_expires_in: access.expiresInSeconds,
      refresh_token: issued.rawToken,
      refresh_expires_in: issued.expiresInSeconds,
      user: { id: userId, role },
    };
  }

  /** POST /v1/auth/logout (§5.2) — idempotent: revokes this session's family. */
  async logout(userId: string, rawRefreshToken: string): Promise<void> {
    await this.refreshTokens.revokeFamilyForRawToken(rawRefreshToken, userId);
  }

  /** POST /v1/auth/logout-all (§5.3) — revoke every session for the user. */
  async logoutAll(userId: string): Promise<void> {
    await this.refreshTokens.revokeAllForUser(userId);
  }

  /** GET /v1/auth/me (§5.4) — minimal; drivers additionally get live verification_status. */
  async me(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AuthError.tokenInvalid('User no longer exists');
    // §5.4: a deactivated account must surface as 403 ("the account is blocked"),
    // not a 200 — the access token is stateless so this is the enforcement point.
    if (!user.isActive) throw AuthError.accountDeactivated();

    const base: MeResponse = { id: user.id, role: user.role, is_active: user.isActive };
    if (user.role === Role.driver) {
      const verification = await this.prisma.driverVerification.findUnique({
        where: { driverId: user.id },
        select: { status: true },
      });
      base.verification_status = verification?.status ?? 'PENDING';
    }
    return base;
  }
}
