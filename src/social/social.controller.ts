import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
  ActivityQueryDto,
  BlockUserDto,
  CreateFriendRequestDto,
  CreateReportDto,
  CursorQueryDto,
  FriendsQueryDto,
  RemoveFriendDto,
  SearchUsersQueryDto,
  UpdatePrivacyDto,
} from './dto/social.dto';
import { SocialService } from './social.service';

@ApiTags('social')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('social')
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search users by username / display name' })
  search(
    @CurrentUser() user: AuthUserPayload,
    @Query() query: SearchUsersQueryDto,
  ) {
    return this.social.searchUsers(user.userId, query.q, query.cursor);
  }

  @Get('suggestions')
  suggestions(
    @CurrentUser() user: AuthUserPayload,
    @Query() query: CursorQueryDto,
  ) {
    return this.social.getSuggestions(user.userId, query.cursor);
  }

  @Get('users/:userId')
  getProfile(
    @CurrentUser() user: AuthUserPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.social.getSocialProfile(user.userId, userId);
  }

  @Get('users/:userId/mutuals')
  mutuals(
    @CurrentUser() user: AuthUserPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.social.listMutuals(user.userId, userId);
  }

  @Get('activity')
  activity(
    @CurrentUser() user: AuthUserPayload,
    @Query() query: ActivityQueryDto,
  ) {
    return this.social.listActivity(
      user.userId,
      query.scope ?? 'friends',
      query.cursor,
    );
  }

  @Get('friends')
  @ApiOperation({ summary: 'Accepted friends (crew list)' })
  listFriends(
    @CurrentUser() user: AuthUserPayload,
    @Query() query: FriendsQueryDto,
  ) {
    return this.social.listFriends(user.userId, {
      online: query.online,
      cursor: query.cursor,
    });
  }

  @Delete('friends/:userId')
  removeFriend(
    @CurrentUser() user: AuthUserPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: RemoveFriendDto,
  ) {
    return this.social.removeFriend(
      user.userId,
      userId,
      body.unfollow ?? false,
    );
  }

  @Post('friend-requests')
  sendRequest(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: CreateFriendRequestDto,
  ) {
    return this.social.sendFriendRequest(
      user.userId,
      dto.receiverId,
      dto.message,
    );
  }

  @Get('friend-requests/incoming')
  incoming(@CurrentUser() user: AuthUserPayload) {
    return this.social.listIncomingRequests(user.userId);
  }

  @Get('friend-requests/outgoing')
  outgoing(@CurrentUser() user: AuthUserPayload) {
    return this.social.listOutgoingRequests(user.userId);
  }

  @Post('friend-requests/:id/accept')
  accept(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.social.acceptFriendRequest(user.userId, id);
  }

  @Post('friend-requests/:id/decline')
  decline(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.social.declineFriendRequest(user.userId, id);
  }

  @Delete('friend-requests/:id')
  cancel(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.social.cancelFriendRequest(user.userId, id);
  }

  @Post('follows/:userId')
  follow(
    @CurrentUser() user: AuthUserPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.social.follow(user.userId, userId);
  }

  @Delete('follows/:userId')
  unfollow(
    @CurrentUser() user: AuthUserPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.social.unfollow(user.userId, userId);
  }

  @Get('followers')
  followers(
    @CurrentUser() user: AuthUserPayload,
    @Query() query: CursorQueryDto,
  ) {
    return this.social.listFollowers(user.userId, query.cursor);
  }

  @Get('following')
  following(
    @CurrentUser() user: AuthUserPayload,
    @Query() query: CursorQueryDto,
  ) {
    return this.social.listFollowing(user.userId, query.cursor);
  }

  @Post('blocks/:userId')
  block(
    @CurrentUser() user: AuthUserPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: BlockUserDto,
  ) {
    return this.social.blockUser(user.userId, userId, body.reasonCode);
  }

  @Delete('blocks/:userId')
  unblock(
    @CurrentUser() user: AuthUserPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.social.unblockUser(user.userId, userId);
  }

  @Get('blocks')
  listBlocks(@CurrentUser() user: AuthUserPayload) {
    return this.social.listBlocks(user.userId);
  }

  @Post('reports')
  report(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: CreateReportDto,
  ) {
    return this.social.createReport({
      reporterId: user.userId,
      reportedUserId: dto.reportedUserId,
      contextType: dto.contextType,
      contextId: dto.contextId,
      reason: dto.reason,
      details: dto.details,
    });
  }

  @Get('privacy')
  getPrivacy(@CurrentUser() user: AuthUserPayload) {
    return this.social.getPrivacy(user.userId);
  }

  @Patch('privacy')
  updatePrivacy(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: UpdatePrivacyDto,
  ) {
    return this.social.updatePrivacy(user.userId, dto);
  }

  @Post('presence/heartbeat')
  heartbeat(@CurrentUser() user: AuthUserPayload) {
    return this.social.heartbeat(user.userId);
  }
}
