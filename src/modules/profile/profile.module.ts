import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

/**
 * Profile owns identity + vehicle details. Imports AuthModule for JwtAuthGuard and
 * CommonModule for the EventBus (emits profile.vehicle.changed). PrismaService is global.
 */
@Module({
  imports: [AuthModule, CommonModule],
  controllers: [ProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
