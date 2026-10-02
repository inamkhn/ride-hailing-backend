import { Provider } from '@nestjs/common';
import Redis from 'ioredis';

/** DI token for the shared Redis connection (rate limits, geo, denylists later). */
export const REDIS_CLIENT = 'REDIS_CLIENT';

export const redisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: () =>
    new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    }),
};
