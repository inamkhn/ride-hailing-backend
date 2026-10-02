import { DocumentType } from '@prisma/client';
import { IsEnum, IsString, Length } from 'class-validator';

/** POST /v1/onboarding/documents (§5.3) — confirm the direct upload finished. */
export class ConfirmUploadDto {
  @IsEnum(DocumentType)
  type!: DocumentType;

  // The key issued to this driver by upload-url; ownership is checked by prefix.
  @IsString()
  @Length(1, 512)
  storage_key!: string;
}
