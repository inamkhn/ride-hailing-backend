import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuthError } from '../../common/errors/auth-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DeviceInfo } from './types/auth.types';
import { generateOpaqueToken, hashToken } from './utils/token-crypto';

/** Result of a successful issue/rotate, ready for the controller to shape into a response. */
export interface IssuedRefresh {
  rawToken: string;
  expiresInSeconds: number;
}

/**
 * Rotating refresh tokens with family-reuse detection (auth-api-spec §6.2, §5.1).
 * - A login (OTP verify / admin login) starts a NEW family.
 * - Every /refresh marks the presented token used and mints a successor in the SAME family.
 * - Presenting an already-used token = reuse → revoke the entire family (kill the chain).
 * Only the SHA-256 hash is stored; the raw token is returned once and never persisted.
 */
@Injectable()
export class RefreshTokenService {
  private readonly rdDays: number;
  private readonly adminHours: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.rdDays = config.get<number>('REFRESH_TTL_RD_DAYS', 30);
    this.adminHours = config.get<number>('REFRESH_TTL_ADMIN_HOURS', 10);
  }

  private expiryFor(role: Role): { date: Date; seconds: number } {
    const seconds =
      role === Role.admin
        ? this.adminHours * 3600
        : this.rdDays * 86400;
    return { date: new Date(Date.now() + seconds * 1000), seconds };
  }

  /**
   * Expiry for a rotated successor. Rider/driver roll forward (§6.2 "rolling"),
   * but an admin token is NOT rolling — the successor inherits the family's
   * original `expiresAt`, so a chain can't be extended indefinitely (§6.2).
   */
  private successorExpiry(role: Role, currentExpiresAt: Date): { date: Date; seconds: number } {
    if (role !== Role.admin) return this.expiryFor(role);
    const seconds = Math.max(0, Math.floor((currentExpiresAt.getTime() - Date.now()) / 1000));
    return { date: currentExpiresAt, seconds };
  }

  /** Start a brand-new family (called on login/OTP-verify success). */
  async issueNewFamily(
    userId: string,
    role: Role,
    device: DeviceInfo,
  ): Promise<IssuedRefresh> {
    const raw = generateOpaqueToken();
    const { date, seconds } = this.expiryFor(role);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId: randomUUID(), // new chain
        tokenHash: hashToken(raw),
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        platform: device.platform ?? null,
        expiresAt: date,
      },
    });
    return { rawToken: raw, expiresInSeconds: seconds };
  }

  /**
   * Rotate a presented refresh token (§5.1 steps 1–5).
   * Throws AuthError.refreshRevoked / accountDeactivated per spec.
   * Returns the user + a freshly issued successor token in the same family.
   */
  async rotate(
    rawPresented: string,
  ): Promise<{ userId: string; role: Role; issued: IssuedRefresh }> {
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawPresented) },
      include: { user: { select: { id: true, role: true, isActive: true } } },
    });

    // Missing / already revoked / expired → generic 401 refresh_revoked.
    if (
      !token ||
      token.revokedAt ||
      token.expiresAt.getTime() < Date.now()
    ) {
      throw AuthError.refreshRevoked();
    }

    // Reuse of an already-rotated token → the whole family is compromised.
    if (token.usedAt) {
      await this.revokeFamily(token.familyId);
      throw AuthError.refreshRevoked();
    }

    if (!token.user.isActive) {
      await this.revokeFamily(token.familyId);
      throw AuthError.accountDeactivated();
    }

    // Claim the presented token atomically (§5.1 step 5 + reuse safety).
    // A conditional update on usedAt/revokedAt is the compare-and-set: two
    // concurrent /refresh calls for the same token can't BOTH succeed — the loser
    // sees count !== 1 and treats it as reuse. We mark used BEFORE minting the
    // successor so a crash can never leave two live tokens in the family.
    const now = new Date();
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: token.id, usedAt: null, revokedAt: null },
      data: { usedAt: now, lastUsedAt: now },
    });
    if (claimed.count !== 1) {
      await this.revokeFamily(token.familyId);
      throw AuthError.refreshRevoked();
    }

    // Successor in the SAME family; admin inherits the family's fixed expiry.
    const { date, seconds } = this.successorExpiry(token.user.role, token.expiresAt);
    const raw = generateOpaqueToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: token.userId,
        familyId: token.familyId, // same chain
        tokenHash: hashToken(raw),
        deviceId: token.deviceId,
        deviceName: token.deviceName,
        platform: token.platform ?? null,
        expiresAt: date,
      },
    });

    return {
      userId: token.user.id,
      role: token.user.role,
      issued: { rawToken: raw, expiresInSeconds: seconds },
    };
  }

  /**
   * Revoke a single session's family (logout this device). Idempotent, and scoped
   * to the authenticated owner: a token belonging to another user is ignored (still
   * a 204) so a caller can't revoke someone else's session by guessing their token.
   */
  async revokeFamilyForRawToken(rawPresented: string, userId: string): Promise<void> {
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawPresented) },
      select: { familyId: true, userId: true },
    });
    if (token && token.userId === userId) await this.revokeFamily(token.familyId);
  }

  /** Revoke every family for a user (logout-all, password change, deactivation). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null, OR: [{ expiresAt: { gt: new Date() } }] },
      data: { revokedAt: new Date() },
    });
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
