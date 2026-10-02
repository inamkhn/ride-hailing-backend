import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuthError } from '../../common/errors/auth-error';
import { JwtPayload } from './types/auth.types';

/**
 * Access-token minting + validation (auth-api-spec §6.1, §7).
 * The ONLY place access tokens are created. Stateless — never touches the DB.
 * Claims: sub, role, jti (+ iat/exp added by the JWT lib). `kid` header set for
 * key rotation. No mutable state (approval/name) ever goes in the token.
 */
@Injectable()
export class TokenService {
  private readonly kid: string;
  private readonly ttlRd: string;
  private readonly ttlAdmin: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.kid = config.get<string>('JWT_KID', 'key-1');
    this.ttlRd = config.get<string>('JWT_ACCESS_TTL_RD', '15m');
    this.ttlAdmin = config.get<string>('JWT_ACCESS_TTL_ADMIN', '10m');
  }

  /** Per-role TTL in seconds (admin shorter, §6.1). */
  accessExpirySeconds(role: Role): number {
    return role === Role.admin
      ? this.durationToSeconds(this.ttlAdmin)
      : this.durationToSeconds(this.ttlRd);
  }

  createAccessToken(sub: string, role: Role): { token: string; expiresInSeconds: number } {
    const payload: JwtPayload = { sub, role, jti: randomUUID() };
    const token = this.jwt.sign(payload, {
      expiresIn: this.accessExpirySeconds(role),
      keyid: this.kid,
    });
    return { token, expiresInSeconds: this.accessExpirySeconds(role) };
  }

  /** Verify + decode. Maps JWT error classes onto §8.6 codes. */
  verifyAccessToken(token: string): JwtPayload {
    try {
      return this.jwt.verify<JwtPayload>(token);
    } catch (err) {
      const name = (err as Error)?.name ?? '';
      if (name === 'TokenExpiredError') throw AuthError.tokenExpired();
      throw AuthError.tokenInvalid();
    }
  }

  /** Extracts a bearer token from an Authorization header value, if present. */
  fromBearer(header: string | undefined): string | null {
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    if (!/^Bearer$/i.test(scheme ?? '') || !value) return null;
    return value;
  }

  /** Minimal ms/`s`/`m`/`h`/`d` parser for the TTL env strings. */
  private durationToSeconds(duration: string): number {
    const match = /^(\d+)([smhd])?$/.exec(duration.trim());
    if (!match) return parseInt(duration, 10) || 900;
    const value = parseInt(match[1]!, 10);
    const unit = match[2] ?? 's';
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return value * multipliers[unit]!;
  }
}
