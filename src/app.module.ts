import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';

import { PrismaModule } from './common/prisma/prisma.module';
import { validateEnv } from './config/env.validation';
import { AuthModule } from './modules/auth/auth.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { ProfileModule } from './modules/profile/profile.module';

// Root of the modular monolith. Feature modules (auth, onboarding, profile, trip, ...)
// are added to `imports` as they are implemented.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    PrismaModule,
    // Baseline IP-authoritative throttling (§8.1). Redis-backed so counts survive
    // across instances and don't leak per-process memory. Per-phone/device limits
    // live in RateLimitService; here we only set the coarse global default.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: Number(config.get<string>('THROTTLE_TTL_MS', '60000')),
            limit: Number(config.get<string>('THROTTLE_LIMIT', '100')),
          },
        ],
        storage: new ThrottlerStorageRedisService(
          config.get<string>('REDIS_URL', 'redis://localhost:6379'),
        ),
      }),
    }),
    AuthModule,
    OnboardingModule,
    ProfileModule,
    // In-process domain events (EventBus) — powers driver.verification.changed and
    // profile.vehicle.changed reactions. Kafka relay is a later concern; the transactional
    // outbox already durably records every event.
    EventEmitterModule.forRoot({ wildcard: true, delimiter: '.' }),
    // Cron scheduler for the document-expiry auto-revoke worker.
    ScheduleModule.forRoot(),
  ],
  controllers: [],
  providers: [
    // Apply the throttler to every route by default (§8.1). Individual endpoints
    // can override with @Throttle() or skip with @SkipThrottle().
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
