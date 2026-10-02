import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../config/redis.config';

/** Outcome of a rate-limit check. */
export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/**
 * Fixed-window counters in Redis (§8.1) for the fine-grained OTP limits keyed by
 * phone / device, which @nestjs/throttler (IP-based) alone can't express.
 * Atomic via MULTI: INCR then set EXPIRE only on the first hit.
 */
@Injectable()
export class RateLimitService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Returns allowed=true and increments, unless the window count would exceed limit. */
  async consume(
    bucket: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const key = `rl:${bucket}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, windowSeconds);
    if (count > limit) {
      const ttl = await this.redis.ttl(key);
      return {
        allowed: false,
        retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
      };
    }
    return { allowed: true };
  }

  /**
   * Escalating resend cooldown (§8.1): a phone must wait longer after each
   * successive request (30s, 60s, 120s, …). Returns remaining cooldown seconds,
   * or 0 when free to send. `step` (1-based) selects the escalating delay.
   */
  async enforceResendCooldown(
    phone: string,
    stepSeconds = 30,
    maxSeconds = 600,
  ): Promise<RateLimitResult> {
    const key = `rl:cooldown:${phone}`;
    const current = await this.redis.get(key);
    if (current) {
      const ttl = await this.redis.pttl(key);
      return { allowed: false, retryAfterSeconds: Math.ceil(ttl / 1000) };
    }
    // Escalate based on how many sends happened in a wider window.
    const countKey = `rl:sendcount:${phone}`;
    const sends = await this.redis.incr(countKey);
    if (sends === 1) await this.redis.expire(countKey, 3600);
    const delay = Math.min(stepSeconds * 2 ** (sends - 1), maxSeconds);
    await this.redis.set(key, '1', 'EX', delay);
    return { allowed: true };
  }
}
