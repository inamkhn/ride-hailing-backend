import { generateOpaqueToken, hashToken } from './token-crypto';

describe('token-crypto', () => {
  describe('hashToken', () => {
    it('produces a deterministic 64-char hex SHA-256 digest', () => {
      const a = hashToken('some-raw-token');
      const b = hashToken('some-raw-token');
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    it('different raw tokens hash to different values', () => {
      expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
    });
  });

  describe('generateOpaqueToken', () => {
    it('returns a high-entropy base64url string', () => {
      const token = generateOpaqueToken();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThanOrEqual(64);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('is non-deterministic across calls', () => {
      expect(generateOpaqueToken()).not.toBe(generateOpaqueToken());
    });
  });
});
