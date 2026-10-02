import { Body, Controller, HttpCode, Ip, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/require-role.decorator';
import { RolesGuard } from '../../common/guards/require-role.guard';
import { AdminAuthService } from './admin-auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { AdminLoginDto, ChangePasswordDto } from './dto/admin-login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { TokenResponse } from './types/auth.types';

/**
 * Admin routes (5, 9 in §1). Login is unauthenticated; change-password requires an
 * admin access token — the acting admin is taken from the JWT `sub`, never the body (§4.2).
 */
@Controller('auth/admin')
export class AdminAuthController {
  constructor(private readonly admin: AdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: AdminLoginDto, @Ip() ip: string): Promise<TokenResponse> {
    return this.admin.login(dto.email, dto.password, dto.totp_code, ip);
  }

  @Post('change-password')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.admin)
  async changePassword(
    @CurrentUser('userId') adminId: string,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.admin.changePassword(adminId, dto.current_password, dto.new_password);
  }
}
