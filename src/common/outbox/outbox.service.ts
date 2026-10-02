import { Injectable } from '@nestjs/common';
import { OutboxEvent, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Transactional outbox (monolith-features.md §5, onboarding-module.md §7).
 * A business write and its `outbox_events` row commit together — the caller passes
 * its own `tx` so enqueue participates in the SAME transaction. A relay later
 * publishes unpublished rows onto the event bus; nothing here fires side effects
 * directly, so an event is never emitted for a rolled-back change.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Insert an outbox row. `tx` is the caller's active transaction client; when
   * omitted (rare, non-transactional producers) it falls back to the bare client.
   */
  async enqueue(
    eventType: string,
    payload: Record<string, unknown>,
    tx?: Prisma.TransactionClient,
  ): Promise<OutboxEvent> {
    const client = tx ?? this.prisma;
    return client.outboxEvent.create({
      data: { eventType, payload: payload as Prisma.InputJsonValue },
    });
  }

  /** Relay hook: all events not yet published, oldest first. */
  async findUnpublished(limit = 100): Promise<OutboxEvent[]> {
    return this.prisma.outboxEvent.findMany({
      where: { publishedAt: null },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  /** Relay hook: stamp an event as published after it hits the bus. */
  async markPublished(id: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: { publishedAt: new Date() },
    });
  }
}
