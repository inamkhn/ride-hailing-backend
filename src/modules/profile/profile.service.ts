import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EventBus } from '../../common/events/event-bus';
import { UpdateProfileDto } from './dto/update-profile.dto';

/** Owns the `users.full_name` + `drivers` vehicle extension (schema §Profile). */
@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
  ) {}

  /**
   * PATCH /v1/profile. Updates name and (for drivers) the single vehicle record. When
   * an APPROVED driver changes a vehicle field, emits `profile.vehicle.changed` so
   * Onboarding resets them to re-review (Onboarding owns that table — §8.3). The emit
   * happens only after the write commits.
   */
  async update(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const isDriver = user.role === 'driver';
    const existing = isDriver
      ? await this.prisma.driver.findUnique({ where: { userId } })
      : null;

    const vehicleTouched = isDriver && (
      dto.vehicle_make !== undefined || dto.vehicle_model !== undefined || dto.vehicle_plate !== undefined
    );
    const vehicleChanged = !!(
      isDriver &&
      ((dto.vehicle_make !== undefined && dto.vehicle_make !== existing?.vehicleMake) ||
        (dto.vehicle_model !== undefined && dto.vehicle_model !== existing?.vehicleModel) ||
        (dto.vehicle_plate !== undefined && dto.vehicle_plate !== existing?.vehiclePlate))
    );

    await this.prisma.$transaction(async (tx) => {
      if (dto.full_name !== undefined) {
        await tx.user.update({ where: { id: userId }, data: { fullName: dto.full_name } });
      }
      if (vehicleTouched) {
        await tx.driver.upsert({
          where: { userId },
          update: {
            vehicleMake: dto.vehicle_make,
            vehicleModel: dto.vehicle_model,
            vehiclePlate: dto.vehicle_plate,
          },
          create: {
            userId,
            vehicleMake: dto.vehicle_make ?? null,
            vehicleModel: dto.vehicle_model ?? null,
            vehiclePlate: dto.vehicle_plate ?? null,
          },
        });
      }
    });

    if (vehicleChanged) {
      this.events.emitProfileVehicleChanged({ driverId: userId });
    }

    return this.view(userId);
  }

  /** GET /v1/profile. */
  async view(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { driverProfile: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return {
      id: user.id,
      role: user.role,
      full_name: user.fullName,
      phone_number: user.phoneNumber,
      vehicle: user.driverProfile
        ? {
            make: user.driverProfile.vehicleMake,
            model: user.driverProfile.vehicleModel,
            plate: user.driverProfile.vehiclePlate,
          }
        : null,
    };
  }
}
