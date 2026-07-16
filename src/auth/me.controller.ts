import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../common/decorators/current-user.decorator';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { AppException } from '../common/errors/app.exception';
import { UpdateProfileDto } from '../profiles/dto/update-profile.dto';
import { ProfileAvatarService } from '../profiles/profile-avatar.service';
import { ProfilesService } from '../profiles/profiles.service';
import { toProfileDto } from './auth.serializer';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeController {
  constructor(
    private readonly authService: AuthService,
    private readonly profilesService: ProfilesService,
    private readonly profileAvatar: ProfileAvatarService,
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

  @Post('avatar')
  @ApiOperation({ summary: 'Upload profile avatar photo (multipart)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: AVATAR_MAX_BYTES },
    }),
  )
  async uploadAvatar(
    @CurrentUser() user: AuthUserPayload,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new AppException(AuthErrorCode.VALIDATION_ERROR, 'Choose a file');
    }
    const profile = await this.profileAvatar.setAvatar(user.userId, file);
    return { profile: toProfileDto(profile, true) };
  }

  @Delete('avatar')
  @ApiOperation({ summary: 'Remove profile avatar photo' })
  async clearAvatar(@CurrentUser() user: AuthUserPayload) {
    const profile = await this.profileAvatar.clearAvatar(user.userId);
    return { profile: toProfileDto(profile, true) };
  }
}
