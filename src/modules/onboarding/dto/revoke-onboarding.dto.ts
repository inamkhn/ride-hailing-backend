import { IsIn, IsString, Length } from 'class-validator';
import { REJECTION_REASON_CODES } from '../types/onboarding.types';

/** POST /v1/admin/onboarding/:driver_id/revoke (§6.5) — pull an APPROVED driver. */
export class RevokeOnboardingDto {
  @IsIn(REJECTION_REASON_CODES as unknown as string[])
  reason_code!: string;

  @IsString()
  @Length(1, 1000)
  message!: string;
}
