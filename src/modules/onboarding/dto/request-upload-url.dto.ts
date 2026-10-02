import { DocumentType } from '@prisma/client';
import { IsEnum, IsInt, IsMimeType, Min } from 'class-validator';

/** POST /v1/onboarding/documents/upload-url (§5.2). */
export class RequestUploadUrlDto {
  @IsEnum(DocumentType, { message: 'type must be a valid document type' })
  type!: DocumentType;

  // Declared by the client but re-verified from storage on confirm (§5.3, §9).
  @IsMimeType()
  content_type!: string;

  @IsInt()
  @Min(1)
  size_bytes!: number;
}
