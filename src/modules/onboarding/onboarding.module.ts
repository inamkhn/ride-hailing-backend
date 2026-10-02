import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { OnboardingAdminController } from './onboarding-admin.controller';
import { OnboardingExpiryWorker } from './onboarding-expiry.worker';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { StorageModule } from './storage/storage.module';

/**
 * Driver onboarding (document review & approval). Imports AuthModule for the shared
 * JwtAuthGuard/RolesGuard, StorageModule for private object storage, and CommonModule
 * for the transactional outbox + event bus. PrismaService is global.
 * Exports OnboardingService so Location/Dispatch can call isDriverApproved (the
 * go-available gate, §8.1). Cron scheduling is enabled app-wide via ScheduleModule.
 */
@Module({
  imports: [AuthModule, StorageModule, CommonModule],
  controllers: [OnboardingController, OnboardingAdminController],
  providers: [OnboardingService, OnboardingExpiryWorker],
  exports: [OnboardingService],
})
export class OnboardingModule {}
