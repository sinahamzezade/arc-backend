import {
  Body,
  Controller,
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
  CreateStudySessionDto,
  StudyChatSendDto,
  StudyCompleteDto,
  StudyHeartbeatDto,
  StudyHistoryQueryDto,
  StudyIdempotencyDto,
  StudyMessagesQueryDto,
  StudyTaskDto,
} from './dto/study-together.dto';
import { StudyTogetherGateway } from './study-together.gateway';
import { StudyTogetherService } from './study-together.service';

@ApiTags('study-together')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('study-together')
export class StudyTogetherController {
  constructor(
    private readonly study: StudyTogetherService,
    private readonly gateway: StudyTogetherGateway,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create Study Together invite' })
  create(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: CreateStudySessionDto,
  ) {
    return this.study.create(user.userId, dto);
  }

  @Get('rooms')
  @ApiOperation({ summary: 'My live study rooms (multi-room hub)' })
  rooms(@CurrentUser() user: AuthUserPayload) {
    return this.study.listRooms(user.userId);
  }

  @Get('invites')
  @ApiOperation({ summary: 'Incoming + outgoing open study invites' })
  invites(@CurrentUser() user: AuthUserPayload) {
    return this.study.listInvites(user.userId);
  }

  @Get('history')
  @ApiOperation({ summary: 'Study session history' })
  history(
    @CurrentUser() user: AuthUserPayload,
    @Query() query: StudyHistoryQueryDto,
  ) {
    return this.study.history(user.userId, query.cursor, query.limit);
  }

  @Post(':id/accept')
  accept(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _dto: StudyIdempotencyDto,
  ) {
    return this.study.accept(user.userId, id);
  }

  @Post(':id/decline')
  decline(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _dto: StudyIdempotencyDto,
  ) {
    return this.study.decline(user.userId, id);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _dto: StudyIdempotencyDto,
  ) {
    return this.study.cancel(user.userId, id);
  }

  @Post(':id/task')
  task(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StudyTaskDto,
  ) {
    return this.study.setTask(user.userId, id, dto);
  }

  @Post(':id/ready')
  ready(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _dto: StudyIdempotencyDto,
  ) {
    return this.study.ready(user.userId, id);
  }

  @Post(':id/heartbeat')
  @ApiOperation({
    summary: 'Room heartbeat (REST fallback; prefer WS study:heartbeat)',
  })
  heartbeat(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StudyHeartbeatDto,
  ) {
    return this.study.heartbeat(user.userId, id, dto);
  }

  @Get(':id/content')
  @ApiOperation({ summary: 'Shared lesson reading body for room' })
  content(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.study.getContent(user.userId, id);
  }

  @Post(':id/ack-read')
  @ApiOperation({ summary: 'Acknowledge current reading step (I read)' })
  ackRead(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { soloAdvance?: boolean },
  ) {
    return this.study.ackRead(user.userId, id, body);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Chat history for study room' })
  messages(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: StudyMessagesQueryDto,
  ) {
    return this.study.listMessages(user.userId, id, query.cursor, query.limit);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Send chat message (REST fallback)' })
  async sendMessage(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StudyChatSendDto,
  ) {
    const msg = await this.study.sendChatMessage(user.userId, id, dto.body);
    this.gateway.broadcastChat(id, msg);
    return msg;
  }

  @Get(':id/state')
  state(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.study.getState(user.userId, id);
  }

  @Post(':id/leave')
  leave(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _dto: StudyIdempotencyDto,
  ) {
    return this.study.leave(user.userId, id);
  }

  @Post(':id/complete')
  complete(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StudyCompleteDto,
  ) {
    return this.study.complete(user.userId, id, dto);
  }
}
