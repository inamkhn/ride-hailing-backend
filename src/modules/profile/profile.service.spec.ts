import { ProfileService } from './profile.service';

/**
 * Covers the §8.3 re-review trigger: Profile never writes the verification table
 * directly (Onboarding owns it). It persists the vehicle edit and, only when a driver
 * actually changes make/model/plate, emits `profile.vehicle.changed` AFTER the commit.
 * Prisma + EventBus are fakes; the transaction helper just runs the callback.
 */
describe('ProfileService', () => {
  let prisma: any;
  let events: any;
  let tx: any;
  let service: ProfileService;

  const driverUser = { id: 'd-1', role: 'driver', fullName: 'Inam', phoneNumber: '+1', driverProfile: { vehicleMake: 'Toyota', vehicleModel: 'Corolla', vehiclePlate: 'ABC-1234' } };
  const riderUser = { id: 'r-1', role: 'rider', fullName: 'Sam', phoneNumber: '+2', driverProfile: null };

  beforeEach(() => {
    tx = { user: { update: jest.fn().mockResolvedValue({}) }, driver: { upsert: jest.fn().mockResolvedValue({}) } };
    prisma = {
      $transaction: jest.fn((cb: any) => cb(tx)),
      user: { findUnique: jest.fn() },
      driver: { findUnique: jest.fn() },
    };
    events = { emitProfileVehicleChanged: jest.fn() };
    service = new ProfileService(prisma, events);
  });

  it('emits profile.vehicle.changed when a driver changes their plate', async () => {
    prisma.user.findUnique.mockResolvedValue(driverUser);
    prisma.driver.findUnique.mockResolvedValue({ userId: 'd-1', vehicleMake: 'Toyota', vehicleModel: 'Corolla', vehiclePlate: 'ABC-1234' });
    await service.update('d-1', { vehicle_plate: 'XYZ-9999' });
    expect(tx.driver.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ vehiclePlate: 'XYZ-9999' }) }),
    );
    expect(events.emitProfileVehicleChanged).toHaveBeenCalledWith({ driverId: 'd-1' });
  });

  it('does not emit when the vehicle values are unchanged', async () => {
    prisma.user.findUnique.mockResolvedValue(driverUser);
    prisma.driver.findUnique.mockResolvedValue({ userId: 'd-1', vehicleMake: 'Toyota', vehicleModel: 'Corolla', vehiclePlate: 'ABC-1234' });
    await service.update('d-1', { vehicle_plate: 'ABC-1234' });
    expect(events.emitProfileVehicleChanged).not.toHaveBeenCalled();
  });

  it('updates name only for a rider without touching the vehicle or emitting', async () => {
    prisma.user.findUnique.mockResolvedValue(riderUser);
    await service.update('r-1', { full_name: 'Sam New' });
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { fullName: 'Sam New' } }));
    expect(tx.driver.upsert).not.toHaveBeenCalled();
    expect(events.emitProfileVehicleChanged).not.toHaveBeenCalled();
  });

  it('throws NotFoundException for an unknown user', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.update('nope', { full_name: 'X' })).rejects.toThrow();
  });
});
