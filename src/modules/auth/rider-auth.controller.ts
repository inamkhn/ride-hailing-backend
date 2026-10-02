import { Body, Controller, HttpCode, Ip, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { OtpService } from './otp.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { OtpVerifyResponse } from './types/auth.types';

/**
 * Rider OTP routes (1–2). Thin by design (§2.2): the only role it can ever
 * create/log in is `rider`, passed here — never read from the body (§2.1).
 */
@Controller('auth/rider')
export class RiderAuthController {
  constructor(private readonly otp: OtpService) {}

  @Post('otp/request')
  @HttpCode(202)
  async request(@Body() dto: SendOtpDto, @Ip() ip: string): Promise<void> {
    await this.otp.requestOtp(Role.rider, dto.phone_number, dto.device_id, ip);
  }

  @Post('otp/verify')
  @HttpCode(200)
  verify(@Body() dto: VerifyOtpDto): Promise<OtpVerifyResponse> {
    return this.otp.verifyOtp(Role.rider, {
      phoneNumber: dto.phone_number,
      code: dto.code,
      deviceId: dto.device_id,
      deviceName: dto.device_name,
      platform: dto.platform,
    });
  }
}
