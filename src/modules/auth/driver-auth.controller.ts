import { Body, Controller, HttpCode, Ip, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { OtpService } from './otp.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { OtpVerifyResponse } from './types/auth.types';

/**
 * Driver OTP routes (3–4). Identical shape to the rider controller except the
 * fixed role — which triggers the driver-only side effect in OtpService (creating
 * the PENDING driver_verifications row atomically, §3.2 step 4).
 */
@Controller('auth/driver')
export class DriverAuthController {
  constructor(private readonly otp: OtpService) {}

  @Post('otp/request')
  @HttpCode(202)
  async request(@Body() dto: SendOtpDto, @Ip() ip: string): Promise<void> {
    await this.otp.requestOtp(Role.driver, dto.phone_number, dto.device_id, ip);
  }

  @Post('otp/verify')
  @HttpCode(200)
  verify(@Body() dto: VerifyOtpDto): Promise<OtpVerifyResponse> {
    return this.otp.verifyOtp(Role.driver, {
      phoneNumber: dto.phone_number,
      code: dto.code,
      deviceId: dto.device_id,
      deviceName: dto.device_name,
      platform: dto.platform,
    });
  }
}
