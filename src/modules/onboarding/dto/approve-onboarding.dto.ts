import { IsISO8601, IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * POST /v1/admin/onboarding/:driver_id/approve (§6.3). The admin carries the
 * submission_number they reviewed — approving a stale set returns 409 (§7).
 * License + registration expiry are required (missing_expiry otherwise); the
 * background-check cert may have no expiry.
 */
export class ApproveOnboardingDto {
  @IsInt()
  @Min(1)
  submission_number!: number;

  @IsISO8601()
  license_expires_on!: string;

  @IsISO8601()
  registration_expires_on!: string;

  @IsOptional()
  @IsISO8601()
  background_check_expires_on?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
