import { Logger } from '@nestjs/common';
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
import { Namespace, Socket } from 'socket.io';
import type { AccessTokenPayload } from '../auth/services/token.service';
import { UsersService } from '../users/users.service';
import { StudyTogetherService } from './study-together.service';

/**
 * Study realtime gateway.
 *
 * - Polling + WebSocket both enabled so it works behind proxies/LBs that block
 *   the WS upgrade (client connects via polling, then upgrades when possible).
 * - `path` overridable via WS_PATH when Nest sits behind a reverse-proxy subpath
 *   (must match the client NEXT_PUBLIC_WS_PATH). Default `/socket.io`.
 * - CORS reflects request origin (credentials-safe) — HTTP CORS is enforced
 *   separately in main.ts via CORS_ORIGIN.
 *
 * NOTE: If you scale Nest to >1 replica, polling requires sticky sessions
 * (or a @socket.io/redis-adapter) since Redis is already available.
 */
@WebSocketGateway({
  namespace: '/study',
  path: process.env.WS_PATH || '/socket.io',
  transports: ['polling', 'websocket'],
  cors: {
    origin: true,
    credentials: true,
  },
})
export class StudyTogetherGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Namespace;

  private readonly logger = new Logger(StudyTogetherGateway.name);
  private readonly socketSessions = new Map<string, string>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly study: StudyTogetherService,
  ) {}

  /**
   * Auth in middleware so `connect` only fires after userId is set.
   * Async handleConnection races with client `join` and drops room membership.
   */
  afterInit(server: Namespace) {
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
        const user = await this.users.findById(payload.sub);
        if (!user?.isActive || user.deletedAt) {
          next(new Error('Unauthorized'));
          return;
        }
        socket.data.userId = user.id;
        next();
      } catch (err) {
        this.logger.debug(
          `WS auth failed: ${err instanceof Error ? err.message : err}`,
        );
        next(new Error('Unauthorized'));
      }
    });
  }

  handleConnection(client: Socket) {
    this.logger.debug(`WS connected ${client.id} user=${client.data.userId}`);
  }

  handleDisconnect(client: Socket) {
    const sessionId = this.socketSessions.get(client.id);
    const userId = client.data.userId as string | undefined;
    if (sessionId && userId) {
      client
        .to(this.roomName(sessionId))
        .emit('partner_presence', { online: false, userId });
    }
    this.socketSessions.delete(client.id);
  }

  @SubscribeMessage('join')
  async onJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { sessionId?: string },
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId || !body?.sessionId) return { error: 'unauthorized' };

    await this.study.requireParticipant(userId, body.sessionId);
    await client.join(this.roomName(body.sessionId));
    this.socketSessions.set(client.id, body.sessionId);

    const state = await this.study.getState(userId, body.sessionId);
    client
      .to(this.roomName(body.sessionId))
      .emit('partner_presence', { online: true, userId });

    return { ok: true, state };
  }

  @SubscribeMessage('leave')
  async onLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { sessionId?: string },
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId || !body?.sessionId) return { ok: true };
    await client.leave(this.roomName(body.sessionId));
    this.socketSessions.delete(client.id);
    client
      .to(this.roomName(body.sessionId))
      .emit('partner_presence', { online: false, userId });
    return { ok: true };
  }

  @SubscribeMessage('heartbeat')
  async onHeartbeat(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: {
      sessionId?: string;
      appVisible?: boolean;
      focusActive?: boolean;
    },
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId || !body?.sessionId) return { error: 'unauthorized' };

    const state = await this.study.heartbeat(userId, body.sessionId, {
      appVisible: body.appVisible,
      focusActive: body.focusActive,
    });
    // Only echo back to this socket — state is role-personalized.
    return state;
  }

  @SubscribeMessage('ack_read')
  async onAckRead(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: { sessionId?: string; soloAdvance?: boolean },
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId || !body?.sessionId) return { error: 'unauthorized' };

    const result = await this.study.ackRead(userId, body.sessionId, {
      soloAdvance: body.soloAdvance,
    });
    // Notify room to refresh (each client re-fetches own personalized state).
    this.server
      .to(this.roomName(body.sessionId))
      .emit('state_dirty', { sessionId: body.sessionId });
    if (result.step) {
      this.server.to(this.roomName(body.sessionId)).emit('step', result.step);
    }
    return result;
  }

  @SubscribeMessage('chat:send')
  async onChatSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { sessionId?: string; body?: string },
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId || !body?.sessionId || !body.body?.trim()) {
      return { error: 'invalid' };
    }

    const msg = await this.study.sendChatMessage(
      userId,
      body.sessionId,
      body.body,
    );
    this.broadcastChat(body.sessionId, msg);
    return msg;
  }

  @SubscribeMessage('typing')
  async onTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { sessionId?: string },
  ) {
    const userId = client.data.userId as string | undefined;
    if (!userId || !body?.sessionId) return { ok: true };
    await this.study.setTyping(userId, body.sessionId);
    client.to(this.roomName(body.sessionId)).emit('partner_typing', { userId });
    return { ok: true };
  }

  broadcastState(sessionId: string, state: unknown) {
    this.server.to(this.roomName(sessionId)).emit('state', state);
  }

  /** Push chat to everyone in the room (WS send + REST fallback). */
  broadcastChat(sessionId: string, msg: unknown) {
    this.server.to(this.roomName(sessionId)).emit('chat:message', msg);
  }

  private roomName(sessionId: string) {
    return `study:${sessionId}`;
  }
}
