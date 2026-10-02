import { IsIn, IsInt, IsString, Length, Min } from 'class-validator';
import { REJECTION_REASON_CODES } from '../types/onboarding.types';

/** POST /v1/admin/onboarding/:driver_id/reject (§6.4). */
export class RejectOnboardingDto {
  @IsInt()
  @Min(1)
  submission_number!: number;

  @IsIn(REJECTION_REASON_CODES as unknown as string[])
  reason_code!: string;

  // Driver-visible explanation; required for every code, mandatory when OTHER (§6.4).
  @IsString()
  @Length(1, 1000)
  message!: string;
}
