import { isCountryAllowed, maskPhone, normalizePhone } from './phone.util';

describe('phone.util', () => {
  describe('normalizePhone', () => {
    it('parses a US E.164 number (with spaces) to canonical form + region', () => {
      const result = normalizePhone('+1 415 555 2671');
      expect(result).not.toBeNull();
      expect(result?.e164).toBe('+14155552671');
      expect(result?.region).toBe('US');
    });

    it('returns null for an unparseable string', () => {
      expect(normalizePhone('not-a-phone')).toBeNull();
    });

    it('trims surrounding whitespace before parsing', () => {
      expect(normalizePhone('  +14155552671  ')?.e164).toBe('+14155552671');
    });
  });

  describe('maskPhone', () => {
    it('keeps the leading + and last two digits only', () => {
      const masked = maskPhone('+14155552671');
      expect(masked.startsWith('+')).toBe(true);
      expect(masked.endsWith('71')).toBe(true);
      expect(masked).not.toContain('41555526');
      expect(masked).toContain('*');
    });

    it('fully masks very short inputs', () => {
      expect(maskPhone('1234')).toBe('****');
    });
  });

  describe('isCountryAllowed', () => {
    it('allows everything when the allowlist is empty', () => {
      expect(isCountryAllowed('US', [])).toBe(true);
    });

    it('permits a listed region case-insensitively', () => {
      expect(isCountryAllowed('us', ['US', 'IN'])).toBe(true);
    });

    it('rejects an unlisted region', () => {
      expect(isCountryAllowed('GB', ['US', 'IN'])).toBe(false);
    });
  });
});
