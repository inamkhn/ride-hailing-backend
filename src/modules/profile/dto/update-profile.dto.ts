import { IsOptional, IsString, Length } from 'class-validator';

/**
 * PATCH /v1/profile — MVP subset (identity name + single-vehicle details). Photo and
 * payment live elsewhere. Vehicle edits by an APPROVED driver trigger onboarding
 * re-review via the profile.vehicle.changed event (onboarding-module.md §8.3).
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  full_name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  vehicle_make?: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  vehicle_model?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  vehicle_plate?: string;
}
