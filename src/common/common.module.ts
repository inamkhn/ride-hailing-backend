import { Module } from '@nestjs/common';
import { OutboxService } from './outbox/outbox.service';
import { EventBus } from './events/event-bus';

/**
 * Cross-cutting, app-wide building blocks shared by feature modules: the
 * transactional outbox writer and the in-process event bus. PrismaService is
 * already @Global(), so it isn't re-provided here. EventEmitter2 comes from
 * EventEmitterModule.forRoot() registered in AppModule.
 */
@Module({
  providers: [OutboxService, EventBus],
  exports: [OutboxService, EventBus],
})
export class CommonModule {}
