import { Module } from '@nestjs/common';
import { redisClientProvider } from '../config/redis.config';
import { OutboxService } from './outbox/outbox.service';
import { RateLimitService } from './rate-limiting/rate-limit.service';
import { EventBus } from './events/event-bus';

/**
 * Cross-cutting, app-wide building blocks shared by feature modules: the shared
 * Redis connection + identity-keyed rate limiter, the transactional outbox writer,
 * and the in-process event bus. PrismaService is already @Global(), so it isn't
 * re-provided here. EventEmitter2 comes from EventEmitterModule.forRoot() in AppModule.
 * Imported by every module that needs these (Auth, Onboarding, Profile, later Trips)
 * so a single RateLimitService / Redis client instance is shared, not duplicated.
 */
@Module({
  providers: [redisClientProvider, RateLimitService, OutboxService, EventBus],
  exports: [RateLimitService, OutboxService, EventBus],
})
export class CommonModule {}
