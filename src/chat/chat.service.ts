import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import {
  DataSource,
  In,
  IsNull,
  Repository,
} from 'typeorm';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { AppException } from '../common/errors/app.exception';
import { RedisService } from '../common/redis/redis.service';
import { OutboxService } from '../gamification/outbox.service';
import {
  NotificationChannel,
  NotificationPriority,
  NotificationType,
} from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { Profile } from '../profiles/entities/profile.entity';
import { SocialPermissionService } from '../social/social-permission.service';
import { SocialPresenceService } from '../social/social-presence.service';
import { SocialService } from '../social/social.service';
import { UploadsService } from '../uploads/uploads.service';
import {
  CHAT_ALLOWED_MIME,
  CHAT_CREATE_RATE_LIMIT,
  CHAT_CREATE_RATE_WINDOW_SEC,
  CHAT_MAX_ATTACHMENT_BYTES,
  CHAT_MAX_BODY_CHARS,
  CHAT_MAX_E2E_BODY_CHARS,
  CHAT_MSG_RATE_LIMIT,
  CHAT_MSG_RATE_WINDOW_SEC,
  CHAT_PRESENCE_TTL_SEC,
  CHAT_TYPING_TTL_SEC,
  CHAT_VOICE_MAX_DURATION_MS,
  CHAT_VOICE_MIN_DURATION_MS,
  ChatAttachmentScanStatus,
  ChatEventType,
  ChatMessageType,
  ConversationMemberRole,
  ConversationType,
  directPairKey,
  isChatAudioMime,
  isE2eBody,
  normalizeMime,
} from './chat.constants';
import { ChatAttachment } from './entities/chat-attachment.entity';
import { ChatConversationKeyWrap } from './entities/chat-conversation-key-wrap.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatReport } from './entities/chat-report.entity';
import { ChatUserKey } from './entities/chat-user-key.entity';
import { ConversationMember } from './entities/conversation-member.entity';
import { Conversation } from './entities/conversation.entity';
import type {
  CreateChatReportDto,
  CreateConversationDto,
  PutConversationKeyWrapsDto,
  SendMessageDto,
} from './dto/chat.dto';

export type ChatMessageDto = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatarUrl: string | null;
  clientMsgId: string;
  type: ChatMessageType;
  body: string | null;
  /** True when body is an e2e:v1: ciphertext envelope. */
  e2e: boolean;
  attachmentId: string | null;
  attachmentUrl: string | null;
  attachmentMime: string | null;
  replyToId: string | null;
  durationMs: number | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  /** True when all other members have read past this message (sender view). */
  seen: boolean;
  replyTo: {
    id: string;
    senderId: string;
    senderName: string;
    body: string | null;
    e2e: boolean;
  } | null;
};

export type ConversationListItemDto = {
  id: string;
  type: ConversationType;
  title: string;
  avatarUrl: string | null;
  peerUserId: string | null;
  /** DM peer online (privacy-gated). Null for groups. */
  peerOnline: boolean | null;
  lastMessage: ChatMessageDto | null;
  /** For list preview: last message was sent by viewer. */
  lastMessageFromMe: boolean;
  unreadCount: number;
  muted: boolean;
  lastMessageAt: string | null;
  updatedAt: string;
  /** Peer's read watermark (DM) — for live seen updates. */
  peerLastReadMessageId: string | null;
  memberCount: number;
  /** DM: viewer has blocked this peer (can unblock). */
  peerBlockedByMe: boolean;
};

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  /** Optional fan-out hooks set by ChatGateway after init. */
  broadcastMessage: ((conversationId: string, msg: ChatMessageDto) => void) | null =
    null;
  broadcastRead: ((
    conversationId: string,
    payload: { conversationId: string; userId: string; lastReadMessageId: string },
  ) => void) | null = null;
  broadcastTyping: ((
    conversationId: string,
    payload: { conversationId: string; userId: string; isTyping: boolean },
  ) => void) | null = null;
  broadcastPresence: ((
    payload: { userId: string; status: 'online' | 'offline'; lastSeen: string },
  ) => void) | null = null;
  broadcastKeysRekeyed: ((
    conversationId: string,
    payload: { conversationId: string; byUserId: string },
  ) => void) | null = null;
  emitUnreadToUser: ((userId: string, unreadTotal: number) => void) | null =
    null;
  isUserInConversationRoom: ((userId: string, conversationId: string) => boolean) | null =
    null;

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationsRepo: Repository<Conversation>,
    @InjectRepository(ConversationMember)
    private readonly membersRepo: Repository<ConversationMember>,
    @InjectRepository(ChatMessage)
    private readonly messagesRepo: Repository<ChatMessage>,
    @InjectRepository(ChatAttachment)
    private readonly attachmentsRepo: Repository<ChatAttachment>,
    @InjectRepository(ChatReport)
    private readonly reportsRepo: Repository<ChatReport>,
    @InjectRepository(ChatUserKey)
    private readonly userKeysRepo: Repository<ChatUserKey>,
    @InjectRepository(ChatConversationKeyWrap)
    private readonly keyWrapsRepo: Repository<ChatConversationKeyWrap>,
    @InjectRepository(Profile)
    private readonly profilesRepo: Repository<Profile>,
    private readonly dataSource: DataSource,
    private readonly permissions: SocialPermissionService,
    private readonly socialPresence: SocialPresenceService,
    private readonly social: SocialService,
    private readonly uploads: UploadsService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
    private readonly outbox: OutboxService,
  ) {}

  // ── Summary / list ─────────────────────────────────────────────

  async getSummary(userId: string) {
    const memberships = await this.membersRepo.find({
      where: { userId, leftAt: IsNull() },
    });
    let unreadTotal = 0;
    let conversationsWithUnread = 0;
    for (const m of memberships) {
      const count = await this.unreadForMember(m);
      if (count > 0) {
        unreadTotal += count;
        conversationsWithUnread += 1;
      }
    }
    return { unreadTotal, conversationsWithUnread };
  }

  async listConversations(userId: string, cursor?: string, limit = 30) {
    const take = Math.min(Math.max(limit || 30, 1), 50);
    const qb = this.membersRepo
      .createQueryBuilder('m')
      .innerJoinAndSelect('m.conversation', 'c')
      .where('m.user_id = :userId', { userId })
      .andWhere('m.left_at IS NULL')
      .orderBy('c.last_message_at', 'DESC', 'NULLS LAST')
      .addOrderBy('c.updated_at', 'DESC')
      .take(take + 1);

    if (cursor) {
      const [at, id] = cursor.split('|');
      if (at && id) {
        qb.andWhere(
          '(c.last_message_at < :at OR (c.last_message_at = :at AND c.id < :id) OR (c.last_message_at IS NULL AND c.updated_at < :at))',
          { at: new Date(at), id },
        );
      }
    }

    const rows = await qb.getMany();
    const page = rows.slice(0, take);
    const items: ConversationListItemDto[] = await Promise.all(
      page.map((m) => this.toConversationListItem(userId, m)),
    );
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > take && last
        ? `${(last.conversation.lastMessageAt ?? last.conversation.updatedAt).toISOString()}|${last.conversation.id}`
        : null;
    return { items, nextCursor };
  }

  async getConversation(userId: string, conversationId: string) {
    const member = await this.requireActiveMember(userId, conversationId);
    return this.toConversationListItem(userId, member);
  }

  // ── Create ─────────────────────────────────────────────────────

  async createConversation(userId: string, dto: CreateConversationDto) {
    await this.assertCreateRateLimit(userId);

    if (dto.type === ConversationType.Direct) {
      if (!dto.peerUserId) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          'peerUserId required for direct',
        );
      }
      const gate = await this.permissions.canMessage(userId, dto.peerUserId);
      if (!gate.allowed) {
        throw new AppException(
          gate.reason === 'blocked'
            ? AuthErrorCode.CHAT_BLOCKED
            : AuthErrorCode.CHAT_DM_NOT_ALLOWED,
          gate.reason === 'blocked'
            ? 'Cannot message this user'
            : 'Direct message not allowed',
          HttpStatus.FORBIDDEN,
        );
      }

      const pair = directPairKey(userId, dto.peerUserId);
      const existing = await this.conversationsRepo.findOne({
        where: { type: ConversationType.Direct, directPairKey: pair },
      });
      if (existing) {
        // Re-join if soft-left
        await this.ensureMember(existing.id, userId, ConversationMemberRole.Member);
        await this.ensureMember(
          existing.id,
          dto.peerUserId,
          ConversationMemberRole.Member,
        );
        const member = await this.requireActiveMember(userId, existing.id);
        return this.toConversationListItem(userId, member);
      }

      return this.dataSource.transaction(async (manager) => {
        const conv = await manager.getRepository(Conversation).save(
          manager.getRepository(Conversation).create({
            type: ConversationType.Direct,
            title: null,
            avatarUrl: null,
            createdBy: userId,
            directPairKey: pair,
            lastMessageAt: null,
          }),
        );
        await manager.getRepository(ConversationMember).save([
          manager.getRepository(ConversationMember).create({
            conversationId: conv.id,
            userId,
            role: ConversationMemberRole.Member,
          }),
          manager.getRepository(ConversationMember).create({
            conversationId: conv.id,
            userId: dto.peerUserId!,
            role: ConversationMemberRole.Member,
          }),
        ]);
        await this.outbox.enqueue(manager, {
          type: ChatEventType.ConversationCreated,
          aggregateId: conv.id,
          payload: {
            conversationId: conv.id,
            type: ConversationType.Direct,
            createdBy: userId,
          },
        });
        const member = await manager.getRepository(ConversationMember).findOneOrFail({
          where: { conversationId: conv.id, userId },
          relations: { conversation: true },
        });
        return this.toConversationListItem(userId, member);
      });
    }

    // Group
    const memberIds = Array.from(
      new Set([userId, ...(dto.memberIds ?? [])].filter(Boolean)),
    );
    if (memberIds.length < 2) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'Group needs at least one other member',
      );
    }
    for (const mid of memberIds) {
      if (mid === userId) continue;
      const gate = await this.permissions.canMessage(userId, mid);
      if (!gate.allowed) {
        throw new AppException(
          gate.reason === 'blocked'
            ? AuthErrorCode.CHAT_BLOCKED
            : AuthErrorCode.CHAT_DM_NOT_ALLOWED,
          'Cannot add this member',
          HttpStatus.FORBIDDEN,
        );
      }
    }

    return this.dataSource.transaction(async (manager) => {
      const conv = await manager.getRepository(Conversation).save(
        manager.getRepository(Conversation).create({
          type: ConversationType.Group,
          title: (dto.title ?? 'Group').slice(0, 120),
          avatarUrl: null,
          createdBy: userId,
          directPairKey: null,
          lastMessageAt: null,
        }),
      );
      await manager.getRepository(ConversationMember).save(
        memberIds.map((id) =>
          manager.getRepository(ConversationMember).create({
            conversationId: conv.id,
            userId: id,
            role:
              id === userId
                ? ConversationMemberRole.Admin
                : ConversationMemberRole.Member,
          }),
        ),
      );
      await this.outbox.enqueue(manager, {
        type: ChatEventType.ConversationCreated,
        aggregateId: conv.id,
        payload: {
          conversationId: conv.id,
          type: ConversationType.Group,
          createdBy: userId,
        },
      });
      const member = await manager.getRepository(ConversationMember).findOneOrFail({
        where: { conversationId: conv.id, userId },
        relations: { conversation: true },
      });
      return this.toConversationListItem(userId, member);
    });
  }

  // ── Messages ───────────────────────────────────────────────────

  async listMessages(
    userId: string,
    conversationId: string,
    opts: { before?: string; after?: string; limit?: number },
  ) {
    await this.requireActiveMember(userId, conversationId);
    const take = Math.min(Math.max(opts.limit || 40, 1), 100);
    const blocked = await this.blockedIds(userId);
    const peerReadAt = await this.getPeerReadWatermark(conversationId, userId);

    const qb = this.messagesRepo
      .createQueryBuilder('msg')
      .where('msg.conversation_id = :conversationId', { conversationId })
      .orderBy('msg.created_at', 'DESC')
      .addOrderBy('msg.id', 'DESC')
      .take(take + 1);

    if (opts.before) {
      const parsed = this.parseCursor(opts.before);
      if (parsed) {
        qb.andWhere(
          '(msg.created_at < :at OR (msg.created_at = :at AND msg.id < :id))',
          { at: parsed.at, id: parsed.id },
        );
      }
    }
    if (opts.after) {
      const parsed = this.parseCursor(opts.after);
      if (parsed) {
        qb.andWhere(
          '(msg.created_at > :at OR (msg.created_at = :at AND msg.id > :id))',
          { at: parsed.at, id: parsed.id },
        );
        qb.orderBy('msg.created_at', 'ASC').addOrderBy('msg.id', 'ASC');
      }
    }

    if (blocked.length) {
      qb.andWhere('msg.sender_id NOT IN (:...blocked)', { blocked });
    }

    let rows = await qb.getMany();
    const hasMore = rows.length > take;
    rows = rows.slice(0, take);
    if (!opts.after) {
      rows = rows.reverse();
    }

    const items = await Promise.all(
      rows.map((m) => this.toMessageDto(m, { viewerId: userId, peerReadAt })),
    );
    const first = rows[0];
    const last = rows[rows.length - 1];
    return {
      items,
      nextBefore:
        hasMore && first
          ? `${first.createdAt.toISOString()}|${first.id}`
          : null,
      nextAfter: last
        ? `${last.createdAt.toISOString()}|${last.id}`
        : null,
    };
  }

  async sendMessage(
    userId: string,
    conversationId: string,
    dto: SendMessageDto,
  ): Promise<ChatMessageDto> {
    await this.requireActiveMember(userId, conversationId);
    await this.assertSendAllowed(userId, conversationId);
    await this.assertMsgRateLimit(userId);

    const type = dto.type ?? ChatMessageType.Text;
    const rawBody = dto.body ?? null;
    const e2e = isE2eBody(rawBody);
    let body: string | null;
    if (e2e) {
      body = rawBody!.trim();
      if (body.length > CHAT_MAX_E2E_BODY_CHARS) {
        throw new AppException(
          AuthErrorCode.CHAT_MESSAGE_TOO_LARGE,
          'Message too large',
        );
      }
    } else {
      body = this.sanitizeBody(rawBody);
      if (type === ChatMessageType.Text) {
        if (!body || !body.trim()) {
          throw new AppException(
            AuthErrorCode.VALIDATION_ERROR,
            'Message body required',
          );
        }
        if (body.length > CHAT_MAX_BODY_CHARS) {
          throw new AppException(
            AuthErrorCode.CHAT_MESSAGE_TOO_LARGE,
            'Message too large',
          );
        }
      }
      this.moderateOrThrow(body);
    }
    if (type === ChatMessageType.Text && e2e && (!body || body.length < 16)) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'Message body required',
      );
    }

    let attachment: ChatAttachment | null = null;
    if (dto.attachmentId) {
      attachment = await this.attachmentsRepo.findOne({
        where: { id: dto.attachmentId, uploaderId: userId },
      });
      if (!attachment) {
        throw new AppException(
          AuthErrorCode.CHAT_ATTACHMENT_REJECTED,
          'Attachment not found',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (attachment.scanStatus === ChatAttachmentScanStatus.Blocked) {
        throw new AppException(
          AuthErrorCode.CHAT_ATTACHMENT_REJECTED,
          'Attachment blocked',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (attachment.scanStatus !== ChatAttachmentScanStatus.Clean) {
        throw new AppException(
          AuthErrorCode.CHAT_ATTACHMENT_REJECTED,
          'Attachment not ready',
          HttpStatus.BAD_REQUEST,
        );
      }
      attachment.conversationId = conversationId;
      await this.attachmentsRepo.save(attachment);
    }

    if (type === ChatMessageType.Audio) {
      if (!attachment) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          'Audio attachment required',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!isChatAudioMime(attachment.mimeType)) {
        throw new AppException(
          AuthErrorCode.CHAT_ATTACHMENT_REJECTED,
          'Attachment is not audio',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    let durationMs: number | null = null;
    if (dto.durationMs != null) {
      const d = Math.round(dto.durationMs);
      if (
        d < CHAT_VOICE_MIN_DURATION_MS ||
        d > CHAT_VOICE_MAX_DURATION_MS
      ) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          'Invalid voice duration',
          HttpStatus.BAD_REQUEST,
        );
      }
      durationMs = d;
    }

    if (dto.replyToId) {
      const reply = await this.messagesRepo.findOne({
        where: { id: dto.replyToId, conversationId },
      });
      if (!reply) {
        throw new AppException(
          AuthErrorCode.CHAT_MESSAGE_NOT_FOUND,
          'Reply target not found',
          HttpStatus.NOT_FOUND,
        );
      }
    }

    // Idempotent upsert
    const existing = await this.messagesRepo.findOne({
      where: {
        conversationId,
        senderId: userId,
        clientMsgId: dto.clientMsgId,
      },
    });
    if (existing) {
      const peerReadAt = await this.getPeerReadWatermark(
        conversationId,
        userId,
      );
      return this.toMessageDto(existing, { viewerId: userId, peerReadAt });
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      const msg = await manager.getRepository(ChatMessage).save(
        manager.getRepository(ChatMessage).create({
          conversationId,
          senderId: userId,
          clientMsgId: dto.clientMsgId,
          type,
          body,
          attachmentId: attachment?.id ?? null,
          replyToId: dto.replyToId ?? null,
          durationMs,
        }),
      );
      await manager.getRepository(Conversation).update(conversationId, {
        lastMessageAt: msg.createdAt,
      });
      await this.outbox.enqueue(manager, {
        type: ChatEventType.MessageSent,
        aggregateId: msg.id,
        payload: {
          messageId: msg.id,
          conversationId,
          senderId: userId,
          type,
        },
      });
      return msg;
    });

    const dtoOut = await this.toMessageDto(saved, {
      viewerId: userId,
      peerReadAt: null,
    });
    this.broadcastMessage?.(conversationId, dtoOut);
    await this.afterMessageSent(userId, conversationId, dtoOut);
    return dtoOut;
  }

  async editMessage(userId: string, messageId: string, body: string) {
    const msg = await this.messagesRepo.findOne({ where: { id: messageId } });
    if (!msg || msg.deletedAt) {
      throw new AppException(
        AuthErrorCode.CHAT_MESSAGE_NOT_FOUND,
        'Message not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (msg.senderId !== userId) {
      throw new AppException(
        AuthErrorCode.CHAT_NOT_MESSAGE_OWNER,
        'Not message owner',
        HttpStatus.FORBIDDEN,
      );
    }
    await this.requireActiveMember(userId, msg.conversationId);
    const e2e = isE2eBody(body);
    let nextBody: string;
    if (e2e) {
      nextBody = body.trim();
      if (nextBody.length > CHAT_MAX_E2E_BODY_CHARS) {
        throw new AppException(
          AuthErrorCode.CHAT_MESSAGE_TOO_LARGE,
          'Message too large',
        );
      }
    } else {
      const sanitized = this.sanitizeBody(body);
      if (!sanitized?.trim()) {
        throw new AppException(AuthErrorCode.VALIDATION_ERROR, 'Body required');
      }
      this.moderateOrThrow(sanitized);
      nextBody = sanitized;
    }
    msg.body = nextBody;
    msg.editedAt = new Date();
    await this.messagesRepo.save(msg);
    const peerReadAt = await this.getPeerReadWatermark(
      msg.conversationId,
      userId,
    );
    const dtoOut = await this.toMessageDto(msg, {
      viewerId: userId,
      peerReadAt,
    });
    this.broadcastMessage?.(msg.conversationId, dtoOut);
    return dtoOut;
  }

  async deleteMessage(userId: string, messageId: string) {
    const msg = await this.messagesRepo.findOne({ where: { id: messageId } });
    if (!msg) {
      throw new AppException(
        AuthErrorCode.CHAT_MESSAGE_NOT_FOUND,
        'Message not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (msg.senderId !== userId) {
      throw new AppException(
        AuthErrorCode.CHAT_NOT_MESSAGE_OWNER,
        'Not message owner',
        HttpStatus.FORBIDDEN,
      );
    }
    await this.requireActiveMember(userId, msg.conversationId);
    msg.body = null;
    msg.deletedAt = new Date();
    await this.messagesRepo.save(msg);
    const peerReadAt = await this.getPeerReadWatermark(
      msg.conversationId,
      userId,
    );
    const dtoOut = await this.toMessageDto(msg, {
      viewerId: userId,
      peerReadAt,
    });
    this.broadcastMessage?.(msg.conversationId, dtoOut);
    return dtoOut;
  }

  async markRead(
    userId: string,
    conversationId: string,
    lastReadMessageId: string,
  ) {
    const member = await this.requireActiveMember(userId, conversationId);
    const msg = await this.messagesRepo.findOne({
      where: { id: lastReadMessageId, conversationId },
    });
    if (!msg) {
      // Idempotent: stale/optimistic client ids must not 404 the watermark call.
      return {
        conversationId,
        userId,
        lastReadMessageId: member.lastReadMessageId ?? lastReadMessageId,
      };
    }
    // Only advance watermark
    if (member.lastReadMessageId) {
      const prev = await this.messagesRepo.findOne({
        where: { id: member.lastReadMessageId },
      });
      if (
        prev &&
        (prev.createdAt > msg.createdAt ||
          (prev.createdAt.getTime() === msg.createdAt.getTime() &&
            prev.id > msg.id))
      ) {
        return {
          conversationId,
          userId,
          lastReadMessageId: member.lastReadMessageId,
        };
      }
    }
    member.lastReadMessageId = lastReadMessageId;
    await this.membersRepo.save(member);
    const payload = { conversationId, userId, lastReadMessageId };
    this.broadcastRead?.(conversationId, payload);
    const summary = await this.getSummary(userId);
    this.emitUnreadToUser?.(userId, summary.unreadTotal);
    return payload;
  }

  // ── Members ────────────────────────────────────────────────────

  async addMembers(userId: string, conversationId: string, userIds: string[]) {
    const member = await this.requireActiveMember(userId, conversationId);
    const conv = member.conversation;
    if (conv.type !== ConversationType.Group) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'Only groups support add members',
      );
    }
    if (member.role !== ConversationMemberRole.Admin) {
      throw new AppException(
        AuthErrorCode.CHAT_ADMIN_REQUIRED,
        'Admin required',
        HttpStatus.FORBIDDEN,
      );
    }
    for (const uid of userIds) {
      const gate = await this.permissions.canMessage(userId, uid);
      if (!gate.allowed) {
        throw new AppException(
          AuthErrorCode.CHAT_DM_NOT_ALLOWED,
          'Cannot add member',
          HttpStatus.FORBIDDEN,
        );
      }
      await this.ensureMember(conversationId, uid, ConversationMemberRole.Member);
    }
    return { ok: true };
  }

  async removeOrLeave(
    actorId: string,
    conversationId: string,
    targetUserId: string,
  ) {
    const actor = await this.requireActiveMember(actorId, conversationId);
    if (actorId !== targetUserId) {
      if (actor.role !== ConversationMemberRole.Admin) {
        throw new AppException(
          AuthErrorCode.CHAT_ADMIN_REQUIRED,
          'Admin required',
          HttpStatus.FORBIDDEN,
        );
      }
    }
    const target = await this.membersRepo.findOne({
      where: { conversationId, userId: targetUserId, leftAt: IsNull() },
    });
    if (!target) {
      throw new AppException(
        AuthErrorCode.CHAT_NOT_A_MEMBER,
        'Not a member',
        HttpStatus.NOT_FOUND,
      );
    }
    target.leftAt = new Date();
    await this.membersRepo.save(target);
    return { ok: true };
  }

  async setMuted(userId: string, conversationId: string, muted: boolean) {
    const member = await this.requireActiveMember(userId, conversationId);
    member.muted = muted;
    await this.membersRepo.save(member);
    return { muted };
  }

  // ── Blocks / reports ───────────────────────────────────────────

  async blockUser(blockerId: string, blockedId: string, reasonCode?: string) {
    const result = await this.social.blockUser(blockerId, blockedId, reasonCode);
    await this.dataSource.transaction(async (manager) => {
      await this.outbox.enqueue(manager, {
        type: ChatEventType.UserBlocked,
        aggregateId: blockedId,
        payload: { blockerId, blockedId },
      });
    });
    return result;
  }

  async unblockUser(blockerId: string, blockedId: string) {
    return this.social.unblockUser(blockerId, blockedId);
  }

  async createReport(reporterId: string, dto: CreateChatReportDto) {
    if (dto.messageId) {
      const msg = await this.messagesRepo.findOne({
        where: { id: dto.messageId },
      });
      if (!msg) {
        throw new AppException(
          AuthErrorCode.CHAT_MESSAGE_NOT_FOUND,
          'Message not found',
          HttpStatus.NOT_FOUND,
        );
      }
    }
    const report = await this.reportsRepo.save(
      this.reportsRepo.create({
        reporterId,
        messageId: dto.messageId ?? null,
        reportedUserId: dto.reportedUserId,
        reason: dto.reason,
        detail: dto.detail ?? null,
      }),
    );
    await this.dataSource.transaction(async (manager) => {
      await this.outbox.enqueue(manager, {
        type: ChatEventType.ReportFiled,
        aggregateId: report.id,
        payload: {
          reportId: report.id,
          reason: report.reason,
          reportedUserId: report.reportedUserId,
          messageId: report.messageId,
        },
      });
    });
    return {
      id: report.id,
      status: report.status,
      reason: report.reason,
      createdAt: report.createdAt.toISOString(),
    };
  }

  // ── E2E keys ───────────────────────────────────────────────────

  async upsertUserPublicKey(userId: string, publicKey: string) {
    const key = publicKey.trim();
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'Invalid public key',
      );
    }
    const existing = await this.userKeysRepo.findOne({ where: { userId } });
    if (existing) {
      // Do not wipe conversation wraps on identity publish.
      // Global wipe made every device/login rotation unreadable; clients
      // re-wrap or reset per conversation when seal_open fails on send.
      existing.publicKey = key;
      await this.userKeysRepo.save(existing);
      return {
        userId,
        publicKey: existing.publicKey,
        updatedAt: existing.updatedAt.toISOString(),
      };
    }
    const saved = await this.userKeysRepo.save(
      this.userKeysRepo.create({ userId, publicKey: key }),
    );
    return {
      userId,
      publicKey: saved.publicKey,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  async resetConversationKeyWraps(userId: string, conversationId: string) {
    await this.requireActiveMember(userId, conversationId);
    await this.keyWrapsRepo.delete({ conversationId });
    this.broadcastKeysRekeyed?.(conversationId, {
      conversationId,
      byUserId: userId,
    });
    return { conversationId, reset: true };
  }

  async getUserPublicKeys(callerId: string, userIdsRaw: string) {
    void callerId;
    const ids = [
      ...new Set(
        userIdsRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ].slice(0, 50);
    if (!ids.length) {
      return { keys: [] as Array<{ userId: string; publicKey: string }> };
    }
    const rows = await this.userKeysRepo.find({
      where: { userId: In(ids) },
    });
    return {
      keys: rows.map((r) => ({ userId: r.userId, publicKey: r.publicKey })),
    };
  }

  async getConversationKeyWrap(userId: string, conversationId: string) {
    await this.requireActiveMember(userId, conversationId);
    const members = await this.membersRepo.find({
      where: { conversationId, leftAt: IsNull() },
    });
    const memberIds = members.map((m) => m.userId);
    const anyWraps = await this.keyWrapsRepo.count({
      where: { conversationId },
    });
    const wraps = await this.keyWrapsRepo.find({
      where: { conversationId, userId },
      order: { keyEpoch: 'DESC' },
      take: 1,
    });
    const wrap = wraps[0] ?? null;
    return {
      conversationId,
      memberIds,
      epoch: wrap?.keyEpoch ?? null,
      wrappedKey: wrap?.wrappedKey ?? null,
      hasWraps: anyWraps > 0,
    };
  }

  async putConversationKeyWraps(
    userId: string,
    conversationId: string,
    dto: PutConversationKeyWrapsDto,
  ) {
    await this.requireActiveMember(userId, conversationId);
    const members = await this.membersRepo.find({
      where: { conversationId, leftAt: IsNull() },
    });
    const memberSet = new Set(members.map((m) => m.userId));
    for (const w of dto.wraps) {
      if (!memberSet.has(w.userId)) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          'Wrap target is not a member',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!/^[A-Za-z0-9_-]{32,4096}$/.test(w.wrappedKey.trim())) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          'Invalid wrapped key',
        );
      }
    }

    const inserted = await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT id FROM conversations WHERE id = $1 FOR UPDATE`,
        [conversationId],
      );
      const repo = manager.getRepository(ChatConversationKeyWrap);
      let insertedCount = 0;
      for (const w of dto.wraps) {
        const row = await repo.findOne({
          where: {
            conversationId,
            userId: w.userId,
            keyEpoch: dto.epoch,
          },
        });
        if (row) {
          // Never overwrite — prevents dual-bootstrap key clash.
          continue;
        }
        await repo.save(
          repo.create({
            conversationId,
            userId: w.userId,
            wrappedKey: w.wrappedKey.trim(),
            keyEpoch: dto.epoch,
          }),
        );
        insertedCount += 1;
      }
      return insertedCount;
    });

    const skipped = dto.wraps.length - inserted;
    return {
      conversationId,
      epoch: dto.epoch,
      count: dto.wraps.length,
      inserted,
      skipped,
    };
  }

  // ── Attachments ────────────────────────────────────────────────

  async uploadAttachment(
    userId: string,
    conversationId: string,
    file: Express.Multer.File,
  ) {
    await this.requireActiveMember(userId, conversationId);
    if (!file?.buffer?.length) {
      throw new AppException(AuthErrorCode.VALIDATION_ERROR, 'File required');
    }
    if (file.size > CHAT_MAX_ATTACHMENT_BYTES) {
      throw new AppException(
        AuthErrorCode.CHAT_MESSAGE_TOO_LARGE,
        'Attachment too large',
      );
    }
    const mime = normalizeMime(file.mimetype || 'application/octet-stream');
    if (!CHAT_ALLOWED_MIME.has(mime)) {
      throw new AppException(
        AuthErrorCode.CHAT_ATTACHMENT_REJECTED,
        'MIME not allowed',
      );
    }
    const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
    const objectKey = `/uploads/chat/${conversationId}/${randomUUID()}.${ext}`;
    await this.uploads.put(objectKey, mime, file.buffer);

    // Scan stub: immediately clean
    const attachment = await this.attachmentsRepo.save(
      this.attachmentsRepo.create({
        uploaderId: userId,
        objectKey,
        mimeType: mime,
        sizeBytes: file.size,
        scanStatus: ChatAttachmentScanStatus.Clean,
        conversationId,
      }),
    );

    return {
      id: attachment.id,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      scanStatus: attachment.scanStatus,
      url: `/chat/attachments/${attachment.id}`,
    };
  }

  async getAttachmentBinary(userId: string, attachmentId: string) {
    const attachment = await this.attachmentsRepo.findOne({
      where: { id: attachmentId },
    });
    if (!attachment) {
      throw new AppException(
        AuthErrorCode.CHAT_ATTACHMENT_REJECTED,
        'Not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (attachment.scanStatus !== ChatAttachmentScanStatus.Clean) {
      throw new AppException(
        AuthErrorCode.CHAT_ATTACHMENT_REJECTED,
        'Attachment not available',
        HttpStatus.FORBIDDEN,
      );
    }
    if (attachment.conversationId) {
      await this.requireActiveMember(userId, attachment.conversationId);
    } else if (attachment.uploaderId !== userId) {
      throw new AppException(
        AuthErrorCode.CHAT_NOT_A_MEMBER,
        'Not allowed',
        HttpStatus.FORBIDDEN,
      );
    }
    const asset = await this.uploads.get(attachment.objectKey);
    if (!asset) {
      throw new AppException(
        AuthErrorCode.CHAT_ATTACHMENT_REJECTED,
        'Missing file',
        HttpStatus.NOT_FOUND,
      );
    }
    return { mime: attachment.mimeType, data: asset.data };
  }

  // ── Presence / typing ──────────────────────────────────────────

  async setPresenceOnline(userId: string) {
    const now = new Date().toISOString();
    await this.redis.set(
      `presence:${userId}`,
      JSON.stringify({ status: 'online', lastSeen: now }),
      CHAT_PRESENCE_TTL_SEC,
    );
    // Keep social presence in sync so friends list + chat share one signal.
    await this.socialPresence.heartbeat(userId);
    this.broadcastPresence?.({ userId, status: 'online', lastSeen: now });
  }

  async setPresenceOffline(userId: string) {
    const now = new Date().toISOString();
    await this.redis.set(
      `presence:${userId}`,
      JSON.stringify({ status: 'offline', lastSeen: now }),
      CHAT_PRESENCE_TTL_SEC * 10,
    );
    this.broadcastPresence?.({ userId, status: 'offline', lastSeen: now });
  }

  async refreshPresence(userId: string) {
    await this.setPresenceOnline(userId);
  }

  async getPresence(userId: string): Promise<{
    status: 'online' | 'offline';
    lastSeen: string | null;
  }> {
    const online = await this.socialPresence.isOnline(userId);
    if (online) {
      return { status: 'online', lastSeen: new Date().toISOString() };
    }
    const raw = await this.redis.get(`presence:${userId}`);
    if (!raw) return { status: 'offline', lastSeen: null };
    try {
      const parsed = JSON.parse(raw) as {
        status?: 'online' | 'offline';
        lastSeen?: string;
      };
      return {
        status: parsed.status === 'online' ? 'online' : 'offline',
        lastSeen: parsed.lastSeen ?? null,
      };
    } catch {
      return { status: 'offline', lastSeen: null };
    }
  }

  /** Presence for a conversation peer (DM) or aggregate for group. */
  async getConversationPresence(viewerId: string, conversationId: string) {
    await this.requireActiveMember(viewerId, conversationId);
    const members = await this.membersRepo.find({
      where: { conversationId, leftAt: IsNull() },
    });
    const others = members.filter((m) => m.userId !== viewerId);
    const items: Array<{
      userId: string;
      online: boolean;
      displayName: string;
    }> = [];
    for (const o of others) {
      const canSee = await this.permissions.canSeePresence(viewerId, o.userId);
      const profile = await this.profilesRepo.findOne({
        where: { userId: o.userId },
      });
      items.push({
        userId: o.userId,
        online: canSee
          ? await this.socialPresence.isOnline(o.userId)
          : false,
        displayName:
          profile?.displayName || profile?.username || 'Learner',
      });
    }
    const anyOnline = items.some((i) => i.online);
    return {
      conversationId,
      online: anyOnline,
      label: anyOnline
        ? items.length === 1
          ? 'Online'
          : `${items.filter((i) => i.online).length} online`
        : items.length === 1
          ? 'Offline'
          : 'No one online',
      members: items,
    };
  }

  async setTyping(userId: string, conversationId: string, isTyping: boolean) {
    await this.requireActiveMember(userId, conversationId);
    const key = `typing:${conversationId}:${userId}`;
    if (isTyping) {
      await this.redis.set(key, '1', CHAT_TYPING_TTL_SEC);
    } else {
      await this.redis.del(key);
    }
    this.broadcastTyping?.(conversationId, {
      conversationId,
      userId,
      isTyping,
    });
  }

  async listActiveConversationIds(userId: string): Promise<string[]> {
    const rows = await this.membersRepo.find({
      where: { userId, leftAt: IsNull() },
      select: { conversationId: true },
    });
    return rows.map((r) => r.conversationId);
  }

  // ── Internals ──────────────────────────────────────────────────

  async requireActiveMember(userId: string, conversationId: string) {
    const member = await this.membersRepo.findOne({
      where: { conversationId, userId, leftAt: IsNull() },
      relations: { conversation: true },
    });
    if (!member) {
      throw new AppException(
        AuthErrorCode.CHAT_NOT_A_MEMBER,
        'Not a conversation member',
        HttpStatus.FORBIDDEN,
      );
    }
    return member;
  }

  /** Peer user id for a direct conversation, or null. */
  async getDirectPeerId(
    conversationId: string,
    userId: string,
  ): Promise<string | null> {
    const members = await this.membersRepo.find({
      where: { conversationId, leftAt: IsNull() },
    });
    const peer = members.find((m) => m.userId !== userId);
    return peer?.userId ?? null;
  }

  /** System call/event line in the thread (broadcasts message.new). */
  async insertSystemMessage(
    conversationId: string,
    body: string,
    actorUserId?: string,
  ): Promise<ChatMessageDto> {
    const members = await this.membersRepo.find({
      where: { conversationId, leftAt: IsNull() },
    });
    if (!members.length) {
      throw new AppException(
        AuthErrorCode.CHAT_CONVERSATION_NOT_FOUND,
        'Conversation not found',
        HttpStatus.NOT_FOUND,
      );
    }
    const senderId = actorUserId ?? members[0].userId;
    const clientMsgId = randomUUID();

    const saved = await this.dataSource.transaction(async (manager) => {
      const msg = await manager.getRepository(ChatMessage).save(
        manager.getRepository(ChatMessage).create({
          conversationId,
          senderId,
          clientMsgId,
          type: ChatMessageType.System,
          body,
          attachmentId: null,
          replyToId: null,
        }),
      );
      await manager.getRepository(Conversation).update(conversationId, {
        lastMessageAt: msg.createdAt,
      });
      return msg;
    });

    const dto = await this.toMessageDto(saved);
    this.broadcastMessage?.(conversationId, dto);
    return dto;
  }

  private async ensureMember(
    conversationId: string,
    userId: string,
    role: ConversationMemberRole,
  ) {
    let m = await this.membersRepo.findOne({
      where: { conversationId, userId },
    });
    if (!m) {
      m = await this.membersRepo.save(
        this.membersRepo.create({ conversationId, userId, role }),
      );
      return m;
    }
    if (m.leftAt) {
      m.leftAt = null;
      await this.membersRepo.save(m);
    }
    return m;
  }

  private async assertSendAllowed(userId: string, conversationId: string) {
    const members = await this.membersRepo.find({
      where: { conversationId, leftAt: IsNull() },
    });
    const others = members.filter((m) => m.userId !== userId);
    for (const other of others) {
      if (await this.permissions.isBlockedEither(userId, other.userId)) {
        throw new AppException(
          AuthErrorCode.CHAT_BLOCKED,
          'Blocked',
          HttpStatus.FORBIDDEN,
        );
      }
    }
  }

  private async afterMessageSent(
    senderId: string,
    conversationId: string,
    msg: ChatMessageDto,
  ) {
    const members = await this.membersRepo.find({
      where: { conversationId, leftAt: IsNull() },
    });
    for (const m of members) {
      if (m.userId === senderId) continue;
      const summary = await this.getSummary(m.userId);
      this.emitUnreadToUser?.(m.userId, summary.unreadTotal);

      const inRoom =
        this.isUserInConversationRoom?.(m.userId, conversationId) ?? false;
      if (!inRoom && !m.muted) {
        const profile = await this.profilesRepo.findOne({
          where: { userId: senderId },
        });
        const name =
          profile?.displayName || profile?.username || 'Someone';
        void this.notifications
          .create({
            userId: m.userId,
            type: NotificationType.ChatMessage,
            title: name,
            body:
              msg.type === ChatMessageType.Text
                ? 'New message'
                : msg.type === ChatMessageType.Audio
                  ? 'Sent a voice message'
                  : msg.type === ChatMessageType.Image
                    ? 'Sent a photo'
                    : 'Sent an attachment',
            actionUrl: `/chat/${conversationId}`,
            payload: {
              conversationId,
              messageId: msg.id,
              senderId,
            },
            dedupeKey: `chat_msg:${conversationId}:${msg.id}:${m.userId}`,
            sourceEventId: msg.id,
            priority: NotificationPriority.Normal,
            channels: [NotificationChannel.InApp, NotificationChannel.Push],
          })
          .catch((err) =>
            this.logger.warn(
              `Chat notify failed: ${err instanceof Error ? err.message : err}`,
            ),
          );
      }
    }
  }

  private async unreadForMember(m: ConversationMember): Promise<number> {
    const qb = this.messagesRepo
      .createQueryBuilder('msg')
      .where('msg.conversation_id = :cid', { cid: m.conversationId })
      .andWhere('msg.sender_id != :uid', { uid: m.userId })
      .andWhere('msg.deleted_at IS NULL');

    if (m.lastReadMessageId) {
      const last = await this.messagesRepo.findOne({
        where: { id: m.lastReadMessageId },
      });
      if (last) {
        qb.andWhere(
          '(msg.created_at > :at OR (msg.created_at = :at AND msg.id > :id))',
          { at: last.createdAt, id: last.id },
        );
      }
    }
    return qb.getCount();
  }

  private async toConversationListItem(
    userId: string,
    member: ConversationMember,
  ): Promise<ConversationListItemDto> {
    const c =
      member.conversation ??
      (await this.conversationsRepo.findOneOrFail({
        where: { id: member.conversationId },
      }));

    let title = c.title ?? 'Chat';
    let avatarUrl = c.avatarUrl;
    let peerUserId: string | null = null;

    if (c.type === ConversationType.Direct) {
      const peers = await this.membersRepo.find({
        where: { conversationId: c.id, leftAt: IsNull() },
      });
      const peer = peers.find((p) => p.userId !== userId);
      peerUserId = peer?.userId ?? null;
      if (peer) {
        const profile = await this.profilesRepo.findOne({
          where: { userId: peer.userId },
        });
        title = profile?.displayName || profile?.username || 'Direct message';
        avatarUrl = profile?.avatarUrl ?? null;
      }
    }

    const lastMsg = await this.messagesRepo.findOne({
      where: { conversationId: c.id },
      order: { createdAt: 'DESC', id: 'DESC' },
    });

    // Hide last message from blocked sender
    let lastDto: ChatMessageDto | null = null;
    const peerReadAt = await this.getPeerReadWatermark(c.id, userId);
    if (lastMsg) {
      const blocked = await this.permissions.isBlockedEither(
        userId,
        lastMsg.senderId,
      );
      if (!blocked) {
        lastDto = await this.toMessageDto(lastMsg, {
          viewerId: userId,
          peerReadAt,
        });
      }
    }

    const peers = await this.membersRepo.find({
      where: { conversationId: c.id, leftAt: IsNull() },
    });
    const peerMember = peers.find((p) => p.userId !== userId);

    let peerOnline: boolean | null = null;
    let peerBlockedByMe = false;
    if (c.type === ConversationType.Direct && peerMember) {
      peerBlockedByMe = await this.permissions.isBlockedBy(
        userId,
        peerMember.userId,
      );
      const canSee = await this.permissions.canSeePresence(
        userId,
        peerMember.userId,
      );
      peerOnline = canSee
        ? await this.socialPresence.isOnline(peerMember.userId)
        : false;
    }

    return {
      id: c.id,
      type: c.type,
      title,
      avatarUrl,
      peerUserId,
      peerOnline,
      lastMessage: lastDto,
      lastMessageFromMe: lastMsg ? lastMsg.senderId === userId : false,
      unreadCount: await this.unreadForMember(member),
      muted: member.muted,
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
      updatedAt: c.updatedAt.toISOString(),
      peerLastReadMessageId: peerMember?.lastReadMessageId ?? null,
      memberCount: peers.length,
      peerBlockedByMe,
    };
  }

  private async toMessageDto(
    msg: ChatMessage,
    opts?: { viewerId?: string; peerReadAt?: Date | null },
  ): Promise<ChatMessageDto> {
    const profile = await this.profilesRepo.findOne({
      where: { userId: msg.senderId },
    });
    let attachmentUrl: string | null = null;
    let attachmentMime: string | null = null;
    if (msg.attachmentId) {
      const att =
        msg.attachment ??
        (await this.attachmentsRepo.findOne({
          where: { id: msg.attachmentId },
        }));
      if (att?.scanStatus === ChatAttachmentScanStatus.Clean) {
        attachmentUrl = `/chat/attachments/${att.id}`;
        attachmentMime = att.mimeType;
      }
    }
    const viewerId = opts?.viewerId;
    const peerReadAt = opts?.peerReadAt ?? null;
    const seen =
      !!viewerId &&
      msg.senderId === viewerId &&
      !!peerReadAt &&
      msg.createdAt.getTime() <= peerReadAt.getTime();

    let replyTo: ChatMessageDto['replyTo'] = null;
    if (msg.replyToId) {
      const parent =
        msg.replyTo ??
        (await this.messagesRepo.findOne({ where: { id: msg.replyToId } }));
      if (parent) {
        const parentProfile = await this.profilesRepo.findOne({
          where: { userId: parent.senderId },
        });
        replyTo = {
          id: parent.id,
          senderId: parent.senderId,
          senderName:
            parentProfile?.displayName ||
            parentProfile?.username ||
            'Learner',
          body: parent.deletedAt
            ? 'Message deleted'
            : parent.body == null
              ? parent.type === ChatMessageType.Image
                ? 'Photo'
                : parent.type === ChatMessageType.Audio
                  ? 'Voice message'
                  : null
              : isE2eBody(parent.body)
                ? parent.body
                : parent.body.slice(0, 160),
          e2e: !parent.deletedAt && isE2eBody(parent.body),
        };
      }
    }

    return {
      id: msg.id,
      conversationId: msg.conversationId,
      senderId: msg.senderId,
      senderName: profile?.displayName || profile?.username || 'Learner',
      senderAvatarUrl: profile?.avatarUrl ?? null,
      clientMsgId: msg.clientMsgId,
      type: msg.type,
      body: msg.deletedAt ? null : msg.body,
      e2e: !msg.deletedAt && isE2eBody(msg.body),
      attachmentId: msg.deletedAt ? null : msg.attachmentId,
      attachmentUrl: msg.deletedAt ? null : attachmentUrl,
      attachmentMime: msg.deletedAt ? null : attachmentMime,
      replyToId: msg.replyToId,
      replyTo,
      durationMs: msg.deletedAt ? null : (msg.durationMs ?? null),
      editedAt: msg.editedAt?.toISOString() ?? null,
      deletedAt: msg.deletedAt?.toISOString() ?? null,
      createdAt: msg.createdAt.toISOString(),
      seen,
    };
  }

  /**
   * Earliest read watermark among other active members.
   * Null if any peer has not read yet.
   */
  private async getPeerReadWatermark(
    conversationId: string,
    viewerId: string,
  ): Promise<Date | null> {
    const others = await this.membersRepo.find({
      where: { conversationId, leftAt: IsNull() },
    });
    const peers = others.filter((m) => m.userId !== viewerId);
    if (!peers.length) return null;

    let minAt: Date | null = null;
    for (const peer of peers) {
      if (!peer.lastReadMessageId) return null;
      const readMsg = await this.messagesRepo.findOne({
        where: { id: peer.lastReadMessageId },
      });
      if (!readMsg) return null;
      if (!minAt || readMsg.createdAt.getTime() < minAt.getTime()) {
        minAt = readMsg.createdAt;
      }
    }
    return minAt;
  }

  private sanitizeBody(raw: string | null): string | null {
    if (raw == null) return null;
    return raw
      .replace(/<[^>]*>/g, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .trim()
      .slice(0, CHAT_MAX_BODY_CHARS);
  }

  private moderateOrThrow(body: string | null) {
    if (!body) return;
    const lower = body.toLowerCase();
    const deny = ['<script', 'javascript:'];
    for (const d of deny) {
      if (lower.includes(d)) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          'Message rejected by moderation',
        );
      }
    }
  }

  private parseCursor(
    cursor: string,
  ): { at: Date; id: string } | null {
    const [at, id] = cursor.split('|');
    if (!at || !id) return null;
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return null;
    return { at: d, id };
  }

  private async blockedIds(userId: string): Promise<string[]> {
    const rows = await this.dataSource.query(
      `
      SELECT blocked_id AS id FROM user_blocks WHERE blocker_id = $1
      UNION
      SELECT blocker_id AS id FROM user_blocks WHERE blocked_id = $1
      `,
      [userId],
    );
    return (rows as { id: string }[]).map((r) => r.id);
  }

  private async assertMsgRateLimit(userId: string) {
    const key = `chat:rl:msg:${userId}`;
    const n = await this.redis.incr(key);
    if (n === 1) {
      await this.redis.expire(key, CHAT_MSG_RATE_WINDOW_SEC);
    }
    if (n > CHAT_MSG_RATE_LIMIT) {
      throw new AppException(
        AuthErrorCode.CHAT_RATE_LIMITED,
        'Too many messages',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async assertCreateRateLimit(userId: string) {
    const key = `chat:rl:create:${userId}`;
    const n = await this.redis.incr(key);
    if (n === 1) {
      await this.redis.expire(key, CHAT_CREATE_RATE_WINDOW_SEC);
    }
    if (n > CHAT_CREATE_RATE_LIMIT) {
      throw new AppException(
        AuthErrorCode.CHAT_RATE_LIMITED,
        'Too many conversations',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
