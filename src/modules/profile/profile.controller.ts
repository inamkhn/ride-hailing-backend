import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';

/** Profile routes. Authenticated (any role); the subject is always the JWT `sub`. */
@Controller('profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  view(@CurrentUser('userId') userId: string) {
    return this.profile.view(userId);
  }

  @Patch()
  update(@CurrentUser('userId') userId: string, @Body() dto: UpdateProfileDto) {
    return this.profile.update(userId, dto);
  }
}
