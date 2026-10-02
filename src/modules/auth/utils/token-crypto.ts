import { createHash, randomBytes } from 'crypto';

/**
 * Refresh-token helpers (auth-api-spec §6.2). The raw token is a high-entropy
 * opaque string returned to the client exactly once; only its SHA-256 hash is
 * ever persisted, so a DB leak can't be replayed against the /refresh endpoint.
 */

/** URL-safe, ~256-bit random token. Never persisted raw. */
export function generateOpaqueToken(): string {
  return randomBytes(48).toString('base64url');
}

/** Deterministic hash used as the lookup key + unique constraint value. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
