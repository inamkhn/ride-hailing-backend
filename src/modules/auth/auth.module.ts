import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { CommonModule } from '../../common/common.module';
import { RolesGuard } from '../../common/guards/require-role.guard';

import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { DriverAuthController } from './driver-auth.controller';
import { RiderAuthController } from './rider-auth.controller';
import { SessionAuthController } from './session-auth.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OtpService } from './otp.service';
import { RefreshTokenService } from './refresh-token.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';
import { TwilioVerifyService } from './twilio-verify.service';

/**
 * Auth module (auth-api-spec). Owns every auth building block: access/refresh token
 * machinery, OTP (Twilio Verify) request/verify, session lifecycle, and admin
 * email/password + TOTP login. PrismaService is @Global so it isn't re-imported here.
 * Exports TokenService/JwtAuthGuard/RolesGuard so later feature modules can guard
 * their endpoints without re-instantiating the auth stack.
 */
@Module({
  imports: [
    // Shared Redis connection + identity-keyed RateLimitService live in CommonModule;
    // importing it (not re-providing) keeps a single Redis client across the app.
    CommonModule,
    // Access-token signing/verification. Secret + kid come from validated env (§6.1);
    // per-role TTL is applied at sign time in TokenService, so no global expiresIn here.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [
    RiderAuthController,
    DriverAuthController,
    SessionAuthController,
    AdminAuthController,
  ],
  providers: [
    TokenService,
    RefreshTokenService,
    TwilioVerifyService,
    TotpService,
    OtpService,
    SessionService,
    AdminAuthService,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [TokenService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
