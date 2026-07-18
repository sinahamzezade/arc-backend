import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import {
  CreateStudyEpisodeDto,
  CreateStudyPathDto,
  CreateStudySessionDto,
  StudyChatSendDto,
  StudyCompleteDto,
  StudyHeartbeatDto,
  StudyHistoryQueryDto,
  StudyIdempotencyDto,
  StudyMessagesQueryDto,
  StudyTaskDto,
} from './dto/study-together.dto';
import {
  STUDY_CHAT_AUDIO_MAX_BYTES,
  STUDY_CHAT_IMAGE_MAX_BYTES,
} from './study.constants';
import { StudyTogetherGateway } from './study-together.gateway';
import { StudyTogetherService } from './study-together.service';

const MEDIA_MAX_BYTES = Math.max(
  STUDY_CHAT_IMAGE_MAX_BYTES,
  STUDY_CHAT_AUDIO_MAX_BYTES,
);

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
  @ApiOperation({ summary: 'Create Study Together invite (legacy one-shot room)' })
  create(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: CreateStudySessionDto,
  ) {
    return this.study.create(user.userId, dto);
  }

  @Post('paths')
  @ApiOperation({ summary: 'Create Unit co-roadmap invite' })
  createPath(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: CreateStudyPathDto,
  ) {
    return this.study.createPath(user.userId, dto);
  }

  @Get('units')
  @ApiOperation({
    summary:
      'Pickable stacks for Study Together (fallback when no path lessons). Prefer lessonId on create.',
  })
  listUnits(@CurrentUser() user: AuthUserPayload) {
    return this.study.listPickableUnits(user.userId);
  }

  @Get('lessons')
  @ApiOperation({
    summary:
      'Pickable reading lessons for Study Together invite (available or completed — unfinished OK)',
  })
  listLessons(@CurrentUser() user: AuthUserPayload) {
    return this.study.listPickableLessons(user.userId);
  }

  @Get('paths')
  @ApiOperation({ summary: 'List my Unit co-roadmaps' })
  listPaths(@CurrentUser() user: AuthUserPayload) {
    return this.study.listPaths(user.userId);
  }

  @Get('paths/:id')
  @ApiOperation({ summary: 'Co-roadmap detail + progress' })
  getPath(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.study.getPathState(user.userId, id);
  }

  @Post('paths/:id/accept')
  acceptPath(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _dto: StudyIdempotencyDto,
  ) {
    return this.study.acceptPath(user.userId, id);
  }

  @Post('paths/:id/decline')
  declinePath(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _dto: StudyIdempotencyDto,
  ) {
    return this.study.declinePath(user.userId, id);
  }

  @Post('paths/:id/cancel')
  cancelPath(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _dto: StudyIdempotencyDto,
  ) {
    return this.study.cancelPath(user.userId, id);
  }

  @Post('paths/:id/episodes')
  @ApiOperation({ summary: 'Start a timed episode room on a path' })
  createEpisode(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateStudyEpisodeDto,
  ) {
    return this.study.createEpisode(user.userId, id, dto);
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

  @Post(':id/messages/read')
  @ApiOperation({ summary: 'Mark study chat as read through latest / messageId' })
  async markMessagesRead(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { messageId?: string },
  ) {
    const receipt = await this.study.markChatRead(
      user.userId,
      id,
      body?.messageId,
    );
    this.gateway.broadcastChatRead(id, receipt);
    return receipt;
  }

  @Post(':id/messages/media')
  @ApiOperation({ summary: 'Send voice or image chat message' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MEDIA_MAX_BYTES },
    }),
  )
  async sendMedia(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body()
    body: {
      kind?: string;
      durationMs?: string;
      caption?: string;
    },
  ) {
    if (!file) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'Choose a file',
      );
    }
    const kind = body.kind === 'voice' ? 'voice' : body.kind === 'image' ? 'image' : null;
    if (!kind) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'kind must be voice or image',
      );
    }
    const durationMs =
      body.durationMs != null && body.durationMs !== ''
        ? Number(body.durationMs)
        : undefined;
    const msg = await this.study.sendChatMedia(user.userId, id, file, {
      kind,
      durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
      caption: body.caption,
    });
    this.gateway.broadcastChat(id, msg);
    return msg;
  }

  @Get(':id/media/:messageId')
  @ApiOperation({ summary: 'Fetch study chat media (participant-only)' })
  async getMedia(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Res() res: Response,
  ) {
    const { mime, data } = await this.study.getChatMedia(
      user.userId,
      id,
      messageId,
    );
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(data);
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
