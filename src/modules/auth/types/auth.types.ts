import { Role } from '@prisma/client';

/** Claims carried in the access-token JWT (auth-api-spec §6.1). */
export interface JwtPayload {
  sub: string; // users.id
  role: Role; // rider | driver | admin (lowercase)
  jti: string; // unique id for logs / optional denylist
  iat?: number;
  exp?: number;
}

/** Shape attached to `request.user` by JwtAuthGuard after validation. */
export interface AuthenticatedUser {
  userId: string;
  role: Role;
  jti: string;
}

/** `user` object in every auth response (§2.3). */
export interface AuthUserDto {
  id: string;
  role: Role;
}

/** Standard token response used by routes 2, 4, 5, 6 (§2.3). */
export interface TokenResponse {
  access_token: string;
  access_expires_in: number; // seconds
  refresh_token: string; // opaque rotating token (raw — shown once)
  refresh_expires_in: number; // seconds
  user: AuthUserDto;
}

/** OTP verify responses add this flag (§2.3). */
export interface OtpVerifyResponse extends TokenResponse {
  is_new_user: boolean;
}

/** GET /me response (§5.4) — deliberately minimal, no profile fields. */
export interface MeResponse {
  id: string;
  role: Role;
  is_active: boolean;
  // present only for drivers, read live from driver_verifications (never from the token)
  verification_status?: 'PENDING' | 'APPROVED' | 'REJECTED';
}

/** Device metadata captured at OTP verify (§3.2 optional input), stored on the refresh token. */
export interface DeviceInfo {
  deviceId?: string;
  deviceName?: string;
  platform?: 'ios' | 'android';
}
