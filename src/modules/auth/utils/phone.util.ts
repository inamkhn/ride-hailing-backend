import phone from 'phone';

/**
 * Phone handling (auth-api-spec §8.4): normalize to E.164 on input, expose the
 * region code for the country allowlist, and provide a masking helper so full
 * numbers never reach logs. Uses the `phone` package default parser.
 */
export interface NormalizedPhone {
  e164: string; // canonical stored form
  region: string; // ISO-3166 alpha-2, uppercased (e.g. "US")
}

/** Returns null if the number can't be parsed into a valid E.164 phone. */
export function normalizePhone(raw: string): NormalizedPhone | null {
  const parsed = phone(raw.trim());
  if (!parsed.isValid || !parsed.phoneNumber) return null;
  return {
    e164: parsed.phoneNumber,
    region: (parsed.countryIso2 ?? '').toUpperCase(),
  };
}

/** Mask all but the last 2 digits, e.g. "+********89". Never log the full number. */
export function maskPhone(e164: string): string {
  if (e164.length <= 4) return '****';
  const tail = e164.slice(-2);
  const head = e164.startsWith('+') ? '+' : '';
  return `${head}${'*'.repeat(Math.max(e164.length - head.length - 2, 2))}${tail}`;
}

/**
 * Country allowlist check (§3.1 step 2, §8.1). Empty allowlist => allow all
 * (target market is an open decision, so MVP defaults to permissive).
 */
export function isCountryAllowed(region: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  return allowlist.includes(region.toUpperCase());
}
