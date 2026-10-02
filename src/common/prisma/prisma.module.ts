import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global so every feature module (auth, onboarding, profile, ...) injects PrismaService
// without re-importing — matches the monolith's single shared connection pool design.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
