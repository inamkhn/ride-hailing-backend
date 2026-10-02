import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

/** Result of a storage HEAD used to re-verify an object after the client claims upload. */
export interface ObjectMeta {
  exists: boolean;
  size?: number;
  contentType?: string;
}

/**
 * Private object-storage wrapper (onboarding-module.md §9). Drivers never POST file
 * bytes through the API — they PUT directly to a short-lived presigned URL for a
 * key WE generated, then confirm; admins get short-lived presigned GET URLs. No
 * public or permanent URL ever leaves this service. S3-compatible (MinIO in dev).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket: string;
  private readonly uploadTtl: number;
  private readonly viewTtl: number;
  private readonly maxSize: number;
  private readonly s3: S3Client;

  constructor(config: ConfigService) {
    this.bucket = config.get<string>('S3_BUCKET', '');
    this.uploadTtl = config.get<number>('DOCUMENT_UPLOAD_URL_TTL_SECONDS', 600);
    this.viewTtl = config.get<number>('DOCUMENT_VIEW_URL_TTL_SECONDS', 300);
    this.maxSize = config.get<number>('DOCUMENT_MAX_SIZE_BYTES', 10485760);
    this.s3 = new S3Client({
      region: config.get<string>('S3_REGION', 'us-east-1'),
      endpoint: config.get<string>('S3_ENDPOINT', 'http://localhost:9000'),
      forcePathStyle: config.get<string>('S3_FORCE_PATH_STYLE', 'true') === 'true',
      credentials: {
        accessKeyId: config.get<string>('S3_ACCESS_KEY_ID', ''),
        secretAccessKey: config.get<string>('S3_SECRET_ACCESS_KEY', ''),
      },
    });
  }

  get maxUploadBytes(): number {
    return this.maxSize;
  }

  /** Server-generated key so a client can never choose the object path. */
  newStorageKey(driverId: string): string {
    return `driver-docs/${driverId}/${randomUUID()}`;
  }

  /** Presigned PUT valid ~uploadTtl seconds. Caller uploads the bytes directly. */
  presignPut(key: string, contentLength: number, contentType: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    });
    return getSignedUrl(this.s3, command, { expiresIn: this.uploadTtl });
  }

  /** Confirm an object exists and re-read its true size/type from storage (§5.3). */
  async head(key: string): Promise<ObjectMeta> {
    try {
      const res = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { exists: true, size: res.ContentLength, contentType: res.ContentType };
    } catch (err) {
      const name = (err as { name?: string; $metadata?: { httpStatusCode?: number } })?.name;
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (name === 'NotFound' || name === 'NoSuchKey' || status === 404) {
        return { exists: false };
      }
      this.logger.error(`Storage HEAD failed for a document key`);
      throw err;
    }
  }

  /** Short-lived presigned GET for admin review; every call is audited upstream. */
  presignGet(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn: this.viewTtl });
  }
}
