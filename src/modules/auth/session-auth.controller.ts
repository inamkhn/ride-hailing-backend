import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from './decorators/current-user.decorator';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { SessionService } from './session.service';
import { MeResponse, TokenResponse } from './types/auth.types';

/**
 * Session routes (6–10 in §1). /refresh is unauthenticated-with-refresh-token;
 * the rest require a valid access token (JwtAuthGuard) so we know the caller.
 */
@Controller('auth')
export class SessionAuthController {
  constructor(private readonly session: SessionService) {}

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshTokenDto): Promise<TokenResponse> {
    return this.session.refresh(dto.refresh_token);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async logout(
    @CurrentUser('userId') userId: string,
    @Body() dto: RefreshTokenDto,
  ): Promise<void> {
    await this.session.logout(userId, dto.refresh_token);
  }

  @Post('logout-all')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async logoutAll(@CurrentUser('userId') userId: string): Promise<void> {
    await this.session.logoutAll(userId);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser('userId') userId: string): Promise<MeResponse> {
    return this.session.me(userId);
  }
}
