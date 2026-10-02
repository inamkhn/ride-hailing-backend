import { IsEmail, IsOptional, IsString, Length, MinLength } from 'class-validator';

/** POST /v1/auth/admin/login (§4.1). */
export class AdminLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  // Optional second factor; required only when the admin has TOTP enabled (§4.1).
  @IsOptional()
  @IsString()
  @Length(6, 6)
  totp_code?: string;
}

/** POST /v1/auth/admin/change-password (§4.2). */
export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  current_password!: string;

  @IsString()
  // Strength policy (length/complexity) validated in AdminAuthService against §8.5.
  @MinLength(8)
  new_password!: string;
}
