import { IsOptional, IsString, Matches } from 'class-validator';

/** POST /v1/auth/{rider|driver}/otp/request (§3.1). No `role` field — role is the route (§2.1). */
export class SendOtpDto {
  // A permissive E.164 shape check here; full parse/validation happens in OtpService.
  @IsString()
  @Matches(/^\+?[1-9]\d{6,14}$/, { message: 'phone_number must be E.164' })
  phone_number!: string;

  @IsOptional()
  @IsString()
  device_id?: string;
}
