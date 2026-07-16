import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import { Namespace, Socket } from 'socket.io';
import type { AccessTokenPayload } from '../auth/services/token.service';
import { AuthUserCacheService } from '../auth/services/auth-user-cache.service';
import { AppException } from '../common/errors/app.exception';
import {
  REDIS_PUB_CLIENT,
  REDIS_SUB_CLIENT,
} from '../common/redis/redis.constants';
import Redis from 'ioredis';
import { UsersService } from '../users/users.service';
import { ChatMessageType } from './chat.constants';
import { ChatService } from './chat.service';

@WebSocketGateway({
  namespace: '/chat',
  path: process.env.WS_PATH || '/socket.io',
  transports: ['polling', 'websocket'],
  cors: {
    origin: true,
    credentials: true,
  },
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Namespace;

  private readonly logger = new Logger(ChatGateway.name);

  /** userId → set of socket ids */
  private readonly userSockets = new Map<string, Set<string>>();
  /** socketId → conversation rooms joined */
  private readonly socketRooms = new Map<string, Set<string>>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly authUserCache: AuthUserCacheService,
    private readonly chat: ChatService,
    @Inject(REDIS_PUB_CLIENT) private readonly redisPub: Redis | null,
    @Inject(REDIS_SUB_CLIENT) private readonly redisSub: Redis | null,
  ) {}

  afterInit(server: Namespace) {
    if (this.redisPub && this.redisSub) {
      server.server.adapter(createAdapter(this.redisPub, this.redisSub));
      this.logger.log('Chat Socket.IO Redis adapter enabled');
    }

    this.chat.broadcastMessage = (conversationId, msg) => {
      this.server
        .to(this.roomName(conversationId))
        .emit('message.new', msg);
      // Delivered ack to sender when at least one other socket is in room
      const others = this.countOthersInRoom(conversationId, msg.senderId);
      if (others > 0) {
        this.emitToUser(msg.senderId, 'message.delivered', {
          messageId: msg.id,
          conversationId,
          userId: msg.senderId,
        });
      }
    };
    this.chat.broadcastRead = (conversationId, payload) => {
      this.server.to(this.roomName(conversationId)).emit('message.read', payload);
    };
    this.chat.broadcastTyping = (conversationId, payload) => {
      this.server.to(this.roomName(conversationId)).emit('typing', payload);
    };
    this.chat.broadcastPresence = (payload) => {
      this.server.emit('presence', payload);
    };
    this.chat.emitUnreadToUser = (userId, unreadTotal) => {
      this.emitToUser(userId, 'unread.changed', { unreadTotal });
    };
    this.chat.isUserInConversationRoom = (userId, conversationId) => {
      const sockets = this.userSockets.get(userId);
      if (!sockets) return false;
      const room = this.roomName(conversationId);
      for (const sid of sockets) {
        const rooms = this.socketRooms.get(sid);
        if (rooms?.has(room)) return true;
      }
      return false;
    };

    server.use(async (socket, next) => {
      try {
        const raw =
          (socket.handshake.auth?.token as string | undefined) ||
          (socket.handshake.headers?.authorization as string | undefined);
        const token = raw?.replace(/^Bearer\s+/i, '').trim();
        if (!token) {
          next(new Error('Unauthorized'));
          return;
        }
        const payload = this.jwt.verify<AccessTokenPayload>(token, {
          secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        });
        const cached = await this.authUserCache.get(payload.sub);
        if (cached) {
          socket.data.userId = cached.userId;
          next();
          return;
        }
        const user = await this.users.findById(payload.sub);
        if (!user?.isActive || user.deletedAt) {
          next(new Error('Unauthorized'));
          return;
        }
        await this.authUserCache.set(user.id, {
          userId: user.id,
          email: user.email,
          emailVerified: Boolean(user.emailVerifiedAt),
        });
        socket.data.userId = user.id;
        next();
      } catch (err) {
        this.logger.debug(
          `Chat WS auth failed: ${err instanceof Error ? err.message : err}`,
        );
        next(new Error('Unauthorized'));
      }
    });
  }

  async handleConnection(client: Socket) {
    const userId = client.data.userId as string | undefined;
    if (!userId) {
      client.disconnect(true);
      return;
    }
    let set = this.userSockets.get(userId);
    if (!set) {
      set = new Set();
      this.userSockets.set(userId, set);
    }
    set.add(client.id);
    this.socketRooms.set(client.id, new Set());

    await this.chat.setPresenceOnline(userId);
    const conversationIds = await this.chat.listActiveConversationIds(userId);
    for (const id of conversationIds) {
      const room = this.roomName(id);
      await client.join(room);
      this.socketRooms.get(client.id)?.add(room);
    }

    const summary = await this.chat.getSummary(userId);
    client.emit('unread.changed', { unreadTotal: summary.unreadTotal });
    this.logger.debug(`Chat WS connected ${client.id} user=${userId}`);
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data.userId as string | undefined;
    this.socketRooms.delete(client.id);
    if (!userId) return;
    const set = this.userSockets.get(userId);
    if (set) {
      set.delete(client.id);
      if (set.size === 0) {
        this.userSockets.delete(userId);
        await this.chat.setPresenceOffline(userId);
      }
    }
  }

  @SubscribeMessage('message.send')
  async onSend(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: {
      conversationId?: string;
      clientMsgId?: string;
      type?: ChatMessageType;
      body?: string;
      attachmentId?: string;
      replyToId?: string;
    },
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId || !body?.conversationId || !body?.clientMsgId) {
      return { error: 'CHAT_NOT_A_MEMBER' };
    }
    try {
      const msg = await this.chat.sendMessage(userId, body.conversationId, {
        clientMsgId: body.clientMsgId,
        type: body.type ?? ChatMessageType.Text,
        body: body.body,
        attachmentId: body.attachmentId,
        replyToId: body.replyToId,
      });
      return { ok: true, message: msg };
    } catch (err) {
      return this.errPayload(err);
    }
  }

  @SubscribeMessage('message.read')
  async onRead(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: { conversationId?: string; lastReadMessageId?: string },
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId || !body?.conversationId || !body?.lastReadMessageId) {
      return { error: 'CHAT_NOT_A_MEMBER' };
    }
    try {
      const payload = await this.chat.markRead(
        userId,
        body.conversationId,
        body.lastReadMessageId,
      );
      return { ok: true, ...payload };
    } catch (err) {
      return this.errPayload(err);
    }
  }

  @SubscribeMessage('typing.start')
  async onTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId || !body?.conversationId) return { error: 'CHAT_NOT_A_MEMBER' };
    try {
      await this.chat.setTyping(userId, body.conversationId, true);
      return { ok: true };
    } catch (err) {
      return this.errPayload(err);
    }
  }

  @SubscribeMessage('typing.stop')
  async onTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId || !body?.conversationId) return { error: 'CHAT_NOT_A_MEMBER' };
    try {
      await this.chat.setTyping(userId, body.conversationId, false);
      return { ok: true };
    } catch (err) {
      return this.errPayload(err);
    }
  }

  @SubscribeMessage('presence.heartbeat')
  async onHeartbeat(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId as string | undefined;
    if (!userId) return { error: 'unauthorized' };
    await this.chat.refreshPresence(userId);
    return { ok: true };
  }

  private roomName(conversationId: string) {
    return `chat:${conversationId}`;
  }

  private emitToUser(userId: string, event: string, payload: unknown) {
    const sockets = this.userSockets.get(userId);
    if (!sockets) return;
    for (const sid of sockets) {
      this.server.to(sid).emit(event, payload);
    }
  }

  private countOthersInRoom(conversationId: string, excludeUserId: string) {
    const room = this.roomName(conversationId);
    let n = 0;
    for (const [uid, sockets] of this.userSockets) {
      if (uid === excludeUserId) continue;
      for (const sid of sockets) {
        if (this.socketRooms.get(sid)?.has(room)) {
          n += 1;
          break;
        }
      }
    }
    return n;
  }

  private errPayload(err: unknown) {
    if (err instanceof AppException) {
      return { error: err.code, message: err.message };
    }
    if (err && typeof err === 'object' && 'code' in err) {
      const e = err as { code?: string; message?: string };
      return { error: e.code ?? 'ERROR', message: e.message };
    }
    return { error: 'ERROR' };
  }
}
