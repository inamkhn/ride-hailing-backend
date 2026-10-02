import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VerificationStatus } from '@prisma/client';

/** Canonical event name (onboarding-module.md §2, §8). Consumers use @OnEvent(...). */
export const DRIVER_VERIFICATION_CHANGED = 'driver.verification.changed';

/** Profile emits this when a driver edits vehicle details; Onboarding reacts (§8.3). */
export const PROFILE_VEHICLE_CHANGED = 'profile.vehicle.changed';

/** Payload replayed onto the bus when the relay publishes a `driver.verification.changed` outbox row. */
export interface DriverVerificationChanged {
  driverId: string;
  from: VerificationStatus;
  to: VerificationStatus;
  submissionNumber: number;
}

/** Payload for a vehicle-detail change (onboarding-module.md §8.3). */
export interface ProfileVehicleChanged {
  driverId: string;
}

/**
 * In-process event bus for the monolith (monolith-features.md §5 — an emitter,
 * NOT Kafka). Producers persist an outbox row in-transaction; the relay then calls
 * these emit* helpers post-commit, so consumers only ever see committed changes.
 * Later modules (Location/Dispatch/Notification) subscribe with @OnEvent(name).
 */
@Injectable()
export class EventBus {
  constructor(private readonly emitter: EventEmitter2) {}

  emitDriverVerificationChanged(payload: DriverVerificationChanged): void {
    this.emitter.emit(DRIVER_VERIFICATION_CHANGED, payload);
  }

  emitProfileVehicleChanged(payload: ProfileVehicleChanged): void {
    this.emitter.emit(PROFILE_VEHICLE_CHANGED, payload);
  }
}
