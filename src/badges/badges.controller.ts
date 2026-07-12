import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import { ParseUUIDPipe } from '@nestjs/common';
import {
  SetBadgeVisibilityDto,
  SetFeaturedBadgesDto,
} from './dto/badges.dto';
import { BadgesService } from './badges.service';

@ApiTags('badges')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class BadgesController {
  constructor(private readonly badges: BadgesService) {}

  @Get('badges')
  @ApiOperation({ summary: 'Active badge catalog' })
  catalog() {
    return this.badges.listCatalog();
  }

  @Get('badges/:code')
  @ApiOperation({ summary: 'Badge detail by code' })
  byCode(@Param('code') code: string) {
    return this.badges.getByCode(code);
  }

  @Get('users/me/badges')
  @ApiOperation({ summary: 'Own badge collection + progress' })
  me(@CurrentUser() user: AuthUserPayload) {
    return this.badges.getMyBadges(user.userId);
  }

  @Get('users/:userId/badges')
  @ApiOperation({ summary: 'Privacy-filtered public badge view' })
  userBadges(
    @CurrentUser() user: AuthUserPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.badges.getUserBadges(user.userId, userId);
  }

  @Put('users/me/badges/featured')
  @ApiOperation({ summary: 'Set up to 4 featured badges' })
  featured(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: SetFeaturedBadgesDto,
  ) {
    return this.badges.setFeatured(user.userId, dto.codes);
  }

  @Put('users/me/badges/visibility')
  @ApiOperation({ summary: 'Badge privacy settings' })
  visibility(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: SetBadgeVisibilityDto,
  ) {
    return this.badges.setVisibility(user.userId, dto);
  }
}
