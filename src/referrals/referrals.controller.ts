import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import {
  ClaimReferralCodeDto,
  CreateReferralLinkDto,
  ReferralCursorDto,
  ReferralShareEventDto,
} from './dto/referrals.dto';
import { ReferralsService } from './referrals.service';

@ApiTags('referrals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Referral dashboard for viewer' })
  getMe(@CurrentUser() user: AuthUserPayload) {
    return this.referrals.getMe(user.userId);
  }

  @Get('invites')
  @ApiOperation({ summary: 'Paginated invite statuses' })
  invites(
    @CurrentUser() user: AuthUserPayload,
    @Query() query: ReferralCursorDto,
  ) {
    return this.referrals.listInvites(
      user.userId,
      query.cursor,
      query.limit,
    );
  }

  @Get('activity')
  @ApiOperation({ summary: 'User-safe status timeline' })
  activity(
    @CurrentUser() user: AuthUserPayload,
    @Query() query: ReferralCursorDto,
  ) {
    return this.referrals.listActivity(
      user.userId,
      query.cursor,
      query.limit,
    );
  }

  @Post('links')
  createLink(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: CreateReferralLinkDto,
  ) {
    return this.referrals.createLink(user.userId, dto);
  }

  @Get('links')
  listLinks(@CurrentUser() user: AuthUserPayload) {
    return this.referrals.listLinks(user.userId);
  }

  @Delete('links/:id')
  revokeLink(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.referrals.revokeLink(user.userId, id);
  }

  @Post('links/:id/share-events')
  shareEvent(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReferralShareEventDto,
  ) {
    return this.referrals.recordShareEvent(user.userId, id, dto);
  }

  @Post('code/rotate')
  @ApiOperation({ summary: 'Rotate stable referral code' })
  rotateCode(@CurrentUser() user: AuthUserPayload) {
    return this.referrals.rotateCode(user.userId);
  }

  @Post('claim-code')
  claimCode(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: ClaimReferralCodeDto,
  ) {
    return this.referrals.claimCode(user.userId, dto.code);
  }
}
