import { Module } from '@nestjs/common';
import { PrismaModule } from './common/prisma/prisma.module';

// Root of the modular monolith. Feature modules (auth, onboarding, profile, trip, ...)
// are added to `imports` as they are implemented.
@Module({
  imports: [PrismaModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
