import { ConfigService } from '@nestjs/config';

// Mock the AWS SDK so no network / real S3 client is built. The S3Client instance
// exposes a jest send() we script per test; getSignedUrl is stubbed to a fixed URL.
const sendMock = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: sendMock })),
  HeadObjectCommand: jest.fn((i: any) => ({ ...i, __t: 'head' })),
  PutObjectCommand: jest.fn((i: any) => ({ ...i, __t: 'put' })),
  GetObjectCommand: jest.fn((i: any) => ({ ...i, __t: 'get' })),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(async (_client: any, command: any) => `signed://${command.__t}`),
}));

import { StorageService } from './storage.service';

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    sendMock.mockReset();
    const config = {
      get: <T>(key: string, def?: T): T =>
        ({
          S3_BUCKET: 'docs',
          DOCUMENT_UPLOAD_URL_TTL_SECONDS: 600,
          DOCUMENT_VIEW_URL_TTL_SECONDS: 300,
          DOCUMENT_MAX_SIZE_BYTES: 10485760,
          S3_REGION: 'us-east-1',
          S3_ENDPOINT: 'http://localhost:9000',
          S3_FORCE_PATH_STYLE: 'true',
          S3_ACCESS_KEY_ID: 'k',
          S3_SECRET_ACCESS_KEY: 's',
        } as any)[key] ?? (def as T),
    } as unknown as ConfigService;
    service = new StorageService(config);
  });

  it('generates a server-side key under the driver prefix (never client-chosen)', () => {
    const key = service.newStorageKey('d-1');
    expect(key).toMatch(/^driver-docs\/d-1\/[0-9a-f-]{36}$/);
    expect(service.newStorageKey('d-1')).not.toBe(key); // uuid per call
  });

  it('exposes the configured max upload size', () => {
    expect(service.maxUploadBytes).toBe(10485760);
  });

  it('presignPut returns a signed URL', async () => {
    await expect(service.presignPut('driver-docs/d-1/x', 1234, 'image/jpeg')).resolves.toBe('signed://put');
  });

  it('presignGet returns a signed URL', async () => {
    await expect(service.presignGet('driver-docs/d-1/x')).resolves.toBe('signed://get');
  });

  it('head maps a stored object to size + content type', async () => {
    sendMock.mockResolvedValue({ ContentLength: 2048, ContentType: 'application/pdf' });
    await expect(service.head('driver-docs/d-1/x')).resolves.toEqual({
      exists: true,
      size: 2048,
      contentType: 'application/pdf',
    });
  });

  it('head treats NotFound/NoSuchKey/404 as absent rather than throwing', async () => {
    sendMock.mockRejectedValue({ name: 'NotFound' });
    await expect(service.head('missing')).resolves.toEqual({ exists: false });
    sendMock.mockRejectedValue({ name: 'NoSuchKey' });
    await expect(service.head('missing')).resolves.toEqual({ exists: false });
    sendMock.mockRejectedValue({ $metadata: { httpStatusCode: 404 } });
    await expect(service.head('missing')).resolves.toEqual({ exists: false });
  });

  it('head rethrows unexpected errors (only 404-class is swallowed)', async () => {
    sendMock.mockRejectedValue({ name: 'AccessDenied' });
    await expect(service.head('x')).rejects.toMatchObject({ name: 'AccessDenied' });
  });
});
