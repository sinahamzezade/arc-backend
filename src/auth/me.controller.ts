import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../common/decorators/current-user.decorator';
import { UpdateProfileDto } from '../profiles/dto/update-profile.dto';
import { ProfilesService } from '../profiles/profiles.service';
import { toProfileDto } from './auth.serializer';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeController {
  constructor(
    private readonly authService: AuthService,
    private readonly profilesService: ProfilesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Current user + profile bootstrap payload' })
  me(@CurrentUser() user: AuthUserPayload) {
    return this.authService.me(user.userId);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update editable profile fields' })
  async updateProfile(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: UpdateProfileDto,
  ) {
    const profile = await this.profilesService.updateForUser(user.userId, dto);
    return { profile: toProfileDto(profile, true) };
  }
}
