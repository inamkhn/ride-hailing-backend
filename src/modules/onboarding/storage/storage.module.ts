import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/** Owns the object-storage boundary. ConfigModule is @Global so ConfigService injects. */
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
