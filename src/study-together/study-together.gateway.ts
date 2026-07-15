import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { AccessTokenPayload } from '../auth/services/token.service';
import { UsersService } from '../users/users.service';
import { StudyTogetherService } from './study-together.service';

@WebSocketGateway({
  namespace: '/study',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class StudyTogetherGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(StudyTogetherGateway.name);
  private readonly socketSessions = new Map<string, string>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly study: StudyTogetherService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const raw =
        (client.handshake.auth?.token as string | undefined) ||
        (client.handshake.headers?.authorization as string | undefined);
      const token = raw?.replace(/^Bearer\s+/i, '').trim();
      if (!token) {
        client.disconnect(true);
        return;
      }
      const payload = this.jwt.verify<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      const user = await this.users.findById(payload.sub);
      if (!user?.isActive || user.deletedAt) {
        client.disconnect(true);
        return;
      }
      client.data.userId = user.id;
    } catch (err) {
      this.logger.debug(
        `WS auth failed: ${err instanceof Error ? err.message : err}`,
      );
      client.disconnect(true);
    }
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
    this.broadcastState(body.sessionId, state);
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
    this.broadcastState(body.sessionId, result.state);
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
    this.server.to(this.roomName(body.sessionId)).emit('chat:message', msg);
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
    client
      .to(this.roomName(body.sessionId))
      .emit('partner_typing', { userId });
    return { ok: true };
  }

  broadcastState(sessionId: string, state: unknown) {
    this.server.to(this.roomName(sessionId)).emit('state', state);
  }

  private roomName(sessionId: string) {
    return `study:${sessionId}`;
  }
}
