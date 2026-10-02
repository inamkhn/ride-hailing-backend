import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import { TotpService } from './totp.service';

describe('TotpService', () => {
  let service: TotpService;

  beforeEach(() => {
    const config = { get: (_k: string, d: string) => d } as unknown as ConfigService;
    service = new TotpService(config);
  });

  it('verifies a freshly generated token for a new secret', () => {
    const secret = service.generateSecret();
    const token = authenticator.generate(secret);
    expect(service.verify(token, secret)).toBe(true);
  });

  it('rejects an incorrect token', () => {
    const secret = service.generateSecret();
    expect(service.verify('000000', secret)).toBe(false);
  });

  it('never throws on malformed input — returns false instead', () => {
    const secret = service.generateSecret();
    expect(() => service.verify('not-a-code', secret)).not.toThrow();
    expect(service.verify('garbage', secret)).toBe(false);
  });

  it('builds an otpauth:// provisioning URI for enrollment', () => {
    const secret = service.generateSecret();
    const uri = service.provisioningUri('ops@example.com', secret);
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain('secret=' + secret);
  });
});
