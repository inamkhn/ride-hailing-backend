import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/require-role.decorator';
import { RolesGuard } from '../../common/guards/require-role.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { RequestUploadUrlDto } from './dto/request-upload-url.dto';
import { OnboardingService } from './onboarding.service';
import { DocumentRecord, StatusView, UploadUrlResponse } from './types/onboarding.types';

/**
 * Driver-facing onboarding routes (§5). The driver is ALWAYS the JWT `sub` — no route
 * takes a driver id, so one driver can never touch another's documents (§5). Guarded
 * to role `driver`; `/me` already gives the bare status, this is the detailed view.
 */
@Controller('onboarding')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.driver)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('status')
  status(@CurrentUser('userId') driverId: string): Promise<StatusView> {
    return this.onboarding.getStatus(driverId);
  }

  @Post('documents/upload-url')
  @HttpCode(201)
  requestUploadUrl(
    @CurrentUser('userId') driverId: string,
    @Body() dto: RequestUploadUrlDto,
  ): Promise<UploadUrlResponse> {
    return this.onboarding.requestUploadUrl(driverId, dto.type, dto.content_type, dto.size_bytes);
  }

  @Post('documents')
  @HttpCode(201)
  confirmUpload(
    @CurrentUser('userId') driverId: string,
    @Body() dto: ConfirmUploadDto,
  ): Promise<DocumentRecord> {
    return this.onboarding.confirmUpload(driverId, dto.type, dto.storage_key);
  }

  @Post('submit')
  @HttpCode(200)
  submit(@CurrentUser('userId') driverId: string): Promise<StatusView> {
    return this.onboarding.submit(driverId);
  }
}
