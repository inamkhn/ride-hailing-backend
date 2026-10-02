import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/require-role.decorator';
import { RolesGuard } from '../../common/guards/require-role.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApproveOnboardingDto } from './dto/approve-onboarding.dto';
import { RejectOnboardingDto } from './dto/reject-onboarding.dto';
import { RevokeOnboardingDto } from './dto/revoke-onboarding.dto';
import { OnboardingService } from './onboarding.service';
import { RejectionReasonCode, StatusView } from './types/onboarding.types';

/**
 * Admin review routes (§6). Guarded to role `admin`; the acting admin is the JWT `sub`
 * and is threaded into every decision so the audit row is attributable — never a body
 * field. Thin delegates into OnboardingService (Backoffice can host these routes later
 * without moving any logic).
 */
@Controller('admin/onboarding')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.admin)
export class OnboardingAdminController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('queue')
  queue(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    const parsedLimit = limit ? Number(limit) : 25;
    const cursorDate = cursor ? new Date(cursor) : undefined;
    return this.onboarding.queue(
      Number.isFinite(parsedLimit) ? parsedLimit : 25,
      cursorDate && !Number.isNaN(cursorDate.getTime()) ? cursorDate : undefined,
    );
  }

  @Get(':driver_id')
  detail(@Param('driver_id') driverId: string, @CurrentUser('userId') adminId: string) {
    return this.onboarding.detail(driverId, adminId);
  }

  @Post(':driver_id/approve')
  @HttpCode(200)
  approve(
    @Param('driver_id') driverId: string,
    @CurrentUser('userId') adminId: string,
    @Body() dto: ApproveOnboardingDto,
  ): Promise<StatusView> {
    return this.onboarding.approve(driverId, adminId, {
      submissionNumber: dto.submission_number,
      licenseExpiresOn: new Date(dto.license_expires_on),
      registrationExpiresOn: new Date(dto.registration_expires_on),
      backgroundCheckExpiresOn: dto.background_check_expires_on
        ? new Date(dto.background_check_expires_on)
        : undefined,
      note: dto.note,
    });
  }

  @Post(':driver_id/reject')
  @HttpCode(200)
  reject(
    @Param('driver_id') driverId: string,
    @CurrentUser('userId') adminId: string,
    @Body() dto: RejectOnboardingDto,
  ): Promise<StatusView> {
    return this.onboarding.reject(driverId, adminId, {
      submissionNumber: dto.submission_number,
      reasonCode: dto.reason_code as RejectionReasonCode,
      message: dto.message,
    });
  }

  @Post(':driver_id/revoke')
  @HttpCode(200)
  revoke(
    @Param('driver_id') driverId: string,
    @CurrentUser('userId') adminId: string,
    @Body() dto: RevokeOnboardingDto,
  ): Promise<StatusView> {
    return this.onboarding.revoke(driverId, adminId, {
      reasonCode: dto.reason_code as RejectionReasonCode,
      message: dto.message,
    });
  }
}
