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
  Res,
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
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { AppException } from '../common/errors/app.exception';
import { CHAT_MAX_ATTACHMENT_BYTES } from './chat.constants';
import { ChatService } from './chat.service';
import {
  AddMembersDto,
  BlockUserDto,
  ConversationsQueryDto,
  CreateChatReportDto,
  CreateConversationDto,
  EditMessageDto,
  MarkReadDto,
  MessagesQueryDto,
  MuteConversationDto,
  SendMessageDto,
} from './dto/chat.dto';

@ApiTags('chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Unread totals for header badge' })
  summary(@CurrentUser() user: AuthUserPayload) {
    return this.chat.getSummary(user.userId);
  }

  @Get('conversations')
  @ApiOperation({ summary: 'Paginated conversation list' })
  listConversations(
    @CurrentUser() user: AuthUserPayload,
    @Query() query: ConversationsQueryDto,
  ) {
    return this.chat.listConversations(
      user.userId,
      query.cursor,
      query.limit,
    );
  }

  @Post('conversations')
  @ApiOperation({ summary: 'Create direct or group conversation' })
  createConversation(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: CreateConversationDto,
  ) {
    return this.chat.createConversation(user.userId, dto);
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Single conversation (list item shape)' })
  getConversation(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chat.getConversation(user.userId, id);
  }

  @Get('conversations/:id/presence')
  @ApiOperation({ summary: 'Online status for conversation members' })
  conversationPresence(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chat.getConversationPresence(user.userId, id);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Cursor-paginated message history' })
  listMessages(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MessagesQueryDto,
  ) {
    return this.chat.listMessages(user.userId, id, {
      before: query.before,
      after: query.after,
      limit: query.limit,
    });
  }

  @Post('conversations/:id/messages')
  @ApiOperation({ summary: 'Send message (REST fallback)' })
  sendMessage(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chat.sendMessage(user.userId, id, dto);
  }

  @Post('conversations/:id/read')
  @ApiOperation({ summary: 'Mark conversation read up to message' })
  markRead(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkReadDto,
  ) {
    return this.chat.markRead(user.userId, id, dto.lastReadMessageId);
  }

  @Post('conversations/:id/members')
  @ApiOperation({ summary: 'Add group members (admin)' })
  addMembers(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMembersDto,
  ) {
    return this.chat.addMembers(user.userId, id, dto.userIds);
  }

  @Delete('conversations/:id/members/:userId')
  @ApiOperation({ summary: 'Remove member or leave' })
  removeMember(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
  ) {
    return this.chat.removeOrLeave(user.userId, id, targetUserId);
  }

  @Patch('conversations/:id/mute')
  @ApiOperation({ summary: 'Mute / unmute conversation' })
  mute(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MuteConversationDto,
  ) {
    return this.chat.setMuted(user.userId, id, dto.muted);
  }

  @Post('conversations/:id/attachments')
  @ApiOperation({ summary: 'Upload chat attachment (multipart)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: CHAT_MAX_ATTACHMENT_BYTES },
    }),
  )
  uploadAttachment(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new AppException(AuthErrorCode.VALIDATION_ERROR, 'Choose a file');
    }
    return this.chat.uploadAttachment(user.userId, id, file);
  }

  @Get('attachments/:id')
  @ApiOperation({ summary: 'Fetch attachment binary (member-only)' })
  async getAttachment(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const { mime, data } = await this.chat.getAttachmentBinary(
      user.userId,
      id,
    );
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(data);
  }

  @Patch('messages/:id')
  @ApiOperation({ summary: 'Edit own message' })
  editMessage(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditMessageDto,
  ) {
    return this.chat.editMessage(user.userId, id, dto.body);
  }

  @Delete('messages/:id')
  @ApiOperation({ summary: 'Soft-delete own message' })
  deleteMessage(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chat.deleteMessage(user.userId, id);
  }

  @Post('blocks')
  @ApiOperation({ summary: 'Block user (social blocks)' })
  block(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: BlockUserDto,
  ) {
    return this.chat.blockUser(user.userId, dto.userId, dto.reasonCode);
  }

  @Delete('blocks/:userId')
  @ApiOperation({ summary: 'Unblock user' })
  unblock(
    @CurrentUser() user: AuthUserPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.chat.unblockUser(user.userId, userId);
  }

  @Post('reports')
  @ApiOperation({ summary: 'Report message or user' })
  report(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: CreateChatReportDto,
  ) {
    return this.chat.createReport(user.userId, dto);
  }
}
