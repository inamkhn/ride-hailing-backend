import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

/** POST /v1/auth/{rider|driver}/otp/verify (§3.2). */
export class VerifyOtpDto {
  @IsString()
  @Matches(/^\+?[1-9]\d{6,14}$/, { message: 'phone_number must be E.164' })
  phone_number!: string;

  @IsString()
  @Length(6, 8)
  code!: string;

  @IsOptional()
  @IsString()
  device_id?: string;

  @IsOptional()
  @IsString()
  device_name?: string;

  @IsOptional()
  @IsIn(['ios', 'android'])
  platform?: 'ios' | 'android';
}
