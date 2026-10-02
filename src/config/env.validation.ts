import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

/**
 * Environment validation (plan: Config section).
 * Fail-fast at boot: a missing/invalid value throws before the app listens.
 * Hard rule from auth-api-spec §8.8: OTP_TEST_BYPASS can never be on in production.
 */
export class EnvVars {
  @IsString()
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  @IsInt()
  @IsOptional()
  PORT = 3000;

  // --- Database / Redis ---
  @IsString()
  @MinLength(1)
  DATABASE_URL!: string;

  @IsString()
  @MinLength(1)
  REDIS_URL!: string;

  // --- JWT (auth-api-spec §6.1) ---
  @IsString()
  @MinLength(16)
  JWT_SECRET!: string;

  @IsString()
  @IsOptional()
  JWT_KID = 'key-1';

  /** Access-token TTL, rider/driver (§6.1: ~15 min) */
  @IsString()
  @IsOptional()
  JWT_ACCESS_TTL_RD = '15m';

  /** Access-token TTL, admin (§6.1: ~10 min — shorter) */
  @IsString()
  @IsOptional()
  JWT_ACCESS_TTL_ADMIN = '10m';

  // --- Refresh tokens (§6.2 Option B) ---
  /** Rolling expiry for rider/driver, days */
  @IsInt()
  @Min(1)
  @Max(365)
  @IsOptional()
  REFRESH_TTL_RD_DAYS = 30;

  /** Non-rolling expiry for admin, hours */
  @IsInt()
  @Min(1)
  @Max(72)
  @IsOptional()
  REFRESH_TTL_ADMIN_HOURS = 10;

  // --- Twilio Verify (§Auth confirmed) ---
  @IsString()
  @IsOptional()
  TWILIO_ACCOUNT_SID?: string;

  @IsString()
  @IsOptional()
  TWILIO_AUTH_TOKEN?: string;

  @IsString()
  @IsOptional()
  TWILIO_VERIFY_SERVICE_SID?: string;

  /** Comma-separated ISO-3166 alpha-2 allowlist; empty = allow all (§8.1, open decision) */
  @IsString()
  @IsOptional()
  OTP_ALLOWED_COUNTRIES = '';

  /** Fixed OTP for designated test numbers — REFUSED in production (§8.8) */
  @IsIn(['true', 'false'])
  @IsOptional()
  OTP_TEST_BYPASS: 'true' | 'false' = 'false';

  @IsString()
  @IsOptional()
  OTP_TEST_CODE?: string;

  // --- Admin TOTP ---
  @IsString()
  @IsOptional()
  TOTP_ISSUER = 'RideHailing Backoffice';
}

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const validated = plainToInstance(EnvVars, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: false,
  });
  if (errors.length > 0) {
    const details = errors
      .map((e) => Object.values(e.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  if (validated.NODE_ENV === 'production' && validated.OTP_TEST_BYPASS === 'true') {
    // §8.8: an env flag that cannot be on in production.
    throw new Error('OTP_TEST_BYPASS must not be enabled in production');
  }
  // Merge the original env back over the validated instance. @nestjs/config uses
  // this return value as the ENTIRE config source, and plainToInstance only maps
  // declared fields — without the spread, any key not on EnvVars (e.g.
  // THROTTLE_TTL_MS, MAPBOX_ACCESS_TOKEN) would be silently dropped from ConfigService.
  return { ...config, ...validated };
}
