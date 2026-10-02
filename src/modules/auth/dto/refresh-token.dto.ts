import { IsString, MinLength } from 'class-validator';

/** POST /v1/auth/refresh (§5.1) and POST /v1/auth/logout (§5.2) both key on the refresh token. */
export class RefreshTokenDto {
  @IsString()
  @MinLength(20)
  refresh_token!: string;
}
