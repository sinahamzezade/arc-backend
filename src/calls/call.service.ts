import { createHmac, timingSafeEqual } from 'crypto';
import {
  forwardRef,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { AppException } from '../common/errors/app.exception';
import { RedisService } from '../common/redis/redis.service';
import { ChatService } from '../chat/chat.service';
import { ConversationType } from '../chat/chat.constants';
import {
  NotificationChannel,
  NotificationPriority,
  NotificationType,
} from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { SocialPermissionService } from '../social/social-permission.service';
import { UsersService } from '../users/users.service';
import {
  CALL_CONNECTING_STALE_MS,
  CALL_IN_CALL_TTL_SEC,
  CALL_INVITE_RATE_LIMIT,
  CALL_INVITE_RATE_WINDOW_SEC,
  CALL_INVITE_TIMEOUT_MS,
  CALL_TURN_TTL_SEC,
  CallEndReason,
  CallMode,
  CallState,
} from './call.constants';
import { Call } from './entities/call.entity';

export type CallDto = {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  mode: CallMode;
  state: CallState;
  endReason: CallEndReason | null;
  usedTurn: boolean;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  createdAt: string;
};

export type IceServersResponse = {
  iceServers: Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
    credentialType?: 'password';
  }>;
  ttlSec: number;
};

@Injectable()
export class CallService {
  private readonly logger = new Logger(CallService.name);
  private readonly inviteTimers = new Map<string, NodeJS.Timeout>();

  /** Wired by ChatGateway afterInit */
  emitToUser?: (userId: string, event: string, payload: unknown) => void;

  constructor(
    @InjectRepository(Call)
    private readonly callsRepo: Repository<Call>,
    @Inject(forwardRef(() => ChatService))
    private readonly chat: ChatService,
    private readonly permissions: SocialPermissionService,
    private readonly users: UsersService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  async getIceServers(userId: string): Promise<IceServersResponse> {
    const stunRaw =
      this.config.get<string>('STUN_URLS') ||
      this.config.get<string>('TURN_STUN_URLS') ||
      'stun:stun.l.google.com:19302';
    const stunUrls = stunRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const iceServers: IceServersResponse['iceServers'] = stunUrls.map(
      (urls) => ({ urls }),
    );

    const secret = this.config.get<string>('TURN_SHARED_SECRET');
    const turnRaw =
      this.config.get<string>('TURN_URLS') ||
      this.config.get<string>('TURN_URIS');
    if (secret && turnRaw) {
      const turnUrls = turnRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const ttl = CALL_TURN_TTL_SEC;
      const expiry = Math.floor(Date.now() / 1000) + ttl;
      const username = `${expiry}:${userId}`;
      const credential = createHmac('sha1', secret)
        .update(username)
        .digest('base64');
      iceServers.push({
        urls: turnUrls.length === 1 ? turnUrls[0] : turnUrls,
        username,
        credential,
        credentialType: 'password',
      });
    }

    return { iceServers, ttlSec: CALL_TURN_TTL_SEC };
  }

  async listHistory(userId: string, limit = 30): Promise<CallDto[]> {
    const rows = await this.callsRepo.find({
      where: [{ callerId: userId }, { calleeId: userId }],
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 50),
    });
    return rows.map((c) => this.toDto(c));
  }

  async invite(
    callerId: string,
    input: { conversationId: string; mode: CallMode; callId: string },
  ): Promise<{
    call: CallDto;
    incoming: {
      callId: string;
      conversationId: string;
      fromUserId: string;
      mode: CallMode;
    };
  }> {
    await this.assertInviteRate(callerId);

    const existing = await this.callsRepo.findOne({
      where: { id: input.callId },
    });
    if (existing) {
      return {
        call: this.toDto(existing),
        incoming: {
          callId: existing.id,
          conversationId: existing.conversationId,
          fromUserId: existing.callerId,
          mode: existing.mode,
        },
      };
    }

    const member = await this.chat.requireActiveMember(
      callerId,
      input.conversationId,
    );
    const conv = member.conversation;
    if (!conv || conv.type !== ConversationType.Direct) {
      throw new AppException(
        AuthErrorCode.CALL_GROUP_UNSUPPORTED,
        'Calls only supported in direct chats',
        HttpStatus.BAD_REQUEST,
      );
    }

    const peerId = await this.chat.getDirectPeerId(
      input.conversationId,
      callerId,
    );
    if (!peerId) {
      throw new AppException(
        AuthErrorCode.CALL_NOT_A_MEMBER,
        'No peer in conversation',
        HttpStatus.FORBIDDEN,
      );
    }

    if (await this.permissions.isBlockedEither(callerId, peerId)) {
      throw new AppException(
        AuthErrorCode.CALL_BLOCKED,
        'Blocked',
        HttpStatus.FORBIDDEN,
      );
    }

    const gate = await this.permissions.canMessage(callerId, peerId);
    if (!gate.allowed) {
      throw new AppException(
        gate.reason === 'blocked'
          ? AuthErrorCode.CALL_BLOCKED
          : AuthErrorCode.CALL_NOT_ALLOWED,
        'Calling not allowed',
        HttpStatus.FORBIDDEN,
      );
    }

    const [callerUser, calleeUser] = await Promise.all([
      this.users.findById(callerId),
      this.users.findById(peerId),
    ]);
    if (callerUser?.isMinor || calleeUser?.isMinor) {
      throw new AppException(
        AuthErrorCode.CALL_NOT_ALLOWED,
        'Calling disabled for this account',
        HttpStatus.FORBIDDEN,
      );
    }

    if (await this.hasLiveCall(callerId)) {
      throw new AppException(
        AuthErrorCode.CALL_BUSY,
        'Already in a call',
        HttpStatus.CONFLICT,
      );
    }
    if (await this.hasLiveCall(peerId)) {
      const busy = await this.callsRepo.save(
        this.callsRepo.create({
          id: input.callId,
          conversationId: input.conversationId,
          callerId,
          calleeId: peerId,
          mode: input.mode,
          state: CallState.Ended,
          endReason: CallEndReason.Busy,
          usedTurn: false,
          startedAt: null,
          endedAt: new Date(),
          durationSec: 0,
        }),
      );
      await this.writeSystemMessage(busy);
      throw new AppException(
        AuthErrorCode.CALL_BUSY,
        'Callee busy',
        HttpStatus.CONFLICT,
      );
    }

    const call = await this.callsRepo.save(
      this.callsRepo.create({
        id: input.callId,
        conversationId: input.conversationId,
        callerId,
        calleeId: peerId,
        mode: input.mode,
        state: CallState.Ringing,
        endReason: null,
        usedTurn: false,
        startedAt: null,
        endedAt: null,
        durationSec: null,
      }),
    );

    await this.setInCall(callerId, call.id);
    await this.setInCall(peerId, call.id);
    this.armInviteTimeout(call.id);

    const incoming = {
      callId: call.id,
      conversationId: call.conversationId,
      fromUserId: callerId,
      mode: call.mode,
    };

    this.emitToUser?.(peerId, 'call.incoming', incoming);

    void this.notifications
      .create({
        userId: peerId,
        type: NotificationType.IncomingCall,
        title: 'Incoming call',
        body: call.mode === CallMode.Video ? 'Video call' : 'Voice call',
        actionUrl: `/chat/${call.conversationId}`,
        payload: {
          callId: call.id,
          conversationId: call.conversationId,
          fromUserId: callerId,
          mode: call.mode,
        },
        dedupeKey: `call_invite:${call.id}`,
        sourceEventId: call.id,
        priority: NotificationPriority.High,
        channels: [NotificationChannel.InApp, NotificationChannel.Push],
      })
      .catch((err) =>
        this.logger.warn(
          `Call notify failed: ${err instanceof Error ? err.message : err}`,
        ),
      );

    return { call: this.toDto(call), incoming };
  }

  async accept(userId: string, callId: string): Promise<CallDto> {
    const call = await this.requireCall(callId);
    if (call.calleeId !== userId) {
      throw new AppException(
        AuthErrorCode.CALL_NOT_A_MEMBER,
        'Only callee can accept',
        HttpStatus.FORBIDDEN,
      );
    }
    if (call.state !== CallState.Ringing) {
      throw new AppException(
        AuthErrorCode.CALL_NOT_FOUND,
        'Call not ringing',
        HttpStatus.BAD_REQUEST,
      );
    }
    this.clearInviteTimeout(callId);
    call.state = CallState.Connecting;
    await this.callsRepo.save(call);
    this.emitToUser?.(call.callerId, 'call.accepted', { callId });
    return this.toDto(call);
  }

  async decline(userId: string, callId: string): Promise<CallDto> {
    const call = await this.requireCall(callId);
    if (call.calleeId !== userId) {
      throw new AppException(
        AuthErrorCode.CALL_NOT_A_MEMBER,
        'Only callee can decline',
        HttpStatus.FORBIDDEN,
      );
    }
    return this.endCall(call, CallEndReason.Declined, {
      notifyCaller: true,
      declinedEvent: true,
    });
  }

  async markConnected(userId: string, callId: string): Promise<CallDto> {
    const call = await this.requireCall(callId);
    this.assertParticipant(call, userId);
    if (call.state === CallState.Ended) {
      return this.toDto(call);
    }
    if (call.state === CallState.Ringing) {
      throw new AppException(
        AuthErrorCode.CALL_NOT_FOUND,
        'Call not accepted yet',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (call.state !== CallState.Active) {
      call.state = CallState.Active;
      call.startedAt = call.startedAt ?? new Date();
      await this.callsRepo.save(call);
    }
    return this.toDto(call);
  }

  async upgrade(
    userId: string,
    callId: string,
    mode: CallMode,
  ): Promise<{ call: CallDto; peerId: string }> {
    const call = await this.requireCall(callId);
    this.assertParticipant(call, userId);
    if (call.state === CallState.Ended) {
      throw new AppException(
        AuthErrorCode.CALL_NOT_FOUND,
        'Call already ended',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (mode === CallMode.Video) {
      call.mode = CallMode.Video;
      await this.callsRepo.save(call);
    }
    const peerId = call.callerId === userId ? call.calleeId : call.callerId;
    return { call: this.toDto(call), peerId };
  }

  async hangup(
    userId: string,
    callId: string,
    opts?: { usedTurn?: boolean; failed?: boolean },
  ): Promise<CallDto> {
    const call = await this.requireCall(callId);
    this.assertParticipant(call, userId);

    if (call.state === CallState.Ended) {
      return this.toDto(call);
    }

    if (opts?.usedTurn) {
      call.usedTurn = true;
    }

    if (opts?.failed) {
      return this.endCall(call, CallEndReason.Failed);
    }

    if (call.state === CallState.Ringing) {
      const reason =
        userId === call.callerId
          ? CallEndReason.Cancelled
          : CallEndReason.Declined;
      return this.endCall(call, reason, {
        notifyPeer: true,
        declinedEvent: reason === CallEndReason.Declined,
      });
    }

    return this.endCall(call, CallEndReason.Completed);
  }

  async relayOpaque(
    userId: string,
    callId: string,
    event: 'call.sdp' | 'call.ice' | 'call.upgrade',
    payload: Record<string, unknown>,
  ): Promise<{ peerId: string }> {
    const call = await this.requireCall(callId);
    this.assertParticipant(call, userId);
    if (call.state === CallState.Ended) {
      throw new AppException(
        AuthErrorCode.CALL_NOT_FOUND,
        'Call already ended',
        HttpStatus.BAD_REQUEST,
      );
    }
    const peerId = call.callerId === userId ? call.calleeId : call.callerId;
    this.emitToUser?.(peerId, event, { callId, ...payload });
    return { peerId };
  }

  async getCallForUser(userId: string, callId: string): Promise<CallDto> {
    const call = await this.requireCall(callId);
    this.assertParticipant(call, userId);
    return this.toDto(call);
  }

  // ── Internals ──────────────────────────────────────────────────

  private async endCall(
    call: Call,
    reason: CallEndReason,
    opts?: {
      notifyCaller?: boolean;
      notifyPeer?: boolean;
      declinedEvent?: boolean;
    },
  ): Promise<CallDto> {
    if (call.state === CallState.Ended) {
      return this.toDto(call);
    }
    this.clearInviteTimeout(call.id);

    const now = new Date();
    call.state = CallState.Ended;
    call.endReason = reason;
    call.endedAt = now;
    if (call.startedAt) {
      call.durationSec = Math.max(
        0,
        Math.round((now.getTime() - call.startedAt.getTime()) / 1000),
      );
    } else {
      call.durationSec = 0;
    }
    await this.callsRepo.save(call);
    await this.clearInCall(call.callerId, call.id);
    await this.clearInCall(call.calleeId, call.id);

    const endedPayload = {
      callId: call.id,
      endReason: call.endReason,
      durationSec: call.durationSec,
      usedTurn: call.usedTurn,
    };
    this.emitToUser?.(call.callerId, 'call.ended', endedPayload);
    this.emitToUser?.(call.calleeId, 'call.ended', endedPayload);

    if (opts?.declinedEvent) {
      this.emitToUser?.(call.callerId, 'call.declined', { callId: call.id });
    }

    await this.writeSystemMessage(call);
    return this.toDto(call);
  }

  private async writeSystemMessage(call: Call) {
    const body = this.systemBody(call);
    try {
      await this.chat.insertSystemMessage(call.conversationId, body);
    } catch (err) {
      this.logger.warn(
        `System message failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private systemBody(call: Call): string {
    const kind = call.mode === CallMode.Video ? 'Video call' : 'Voice call';
    switch (call.endReason) {
      case CallEndReason.Completed: {
        const d = call.durationSec ?? 0;
        const m = Math.floor(d / 60);
        const s = d % 60;
        return `${kind} · ${m}:${String(s).padStart(2, '0')}`;
      }
      case CallEndReason.Missed:
        return `Missed ${call.mode === CallMode.Video ? 'video' : 'voice'} call`;
      case CallEndReason.Declined:
        return 'Declined call';
      case CallEndReason.Busy:
        return 'Busy';
      case CallEndReason.Cancelled:
        return 'Cancelled call';
      case CallEndReason.Failed:
        return "Couldn't connect";
      default:
        return kind;
    }
  }

  private armInviteTimeout(callId: string) {
    this.clearInviteTimeout(callId);
    const t = setTimeout(() => {
      void this.onInviteTimeout(callId);
    }, CALL_INVITE_TIMEOUT_MS);
    this.inviteTimers.set(callId, t);
  }

  private clearInviteTimeout(callId: string) {
    const t = this.inviteTimers.get(callId);
    if (t) {
      clearTimeout(t);
      this.inviteTimers.delete(callId);
    }
  }

  private async onInviteTimeout(callId: string) {
    this.inviteTimers.delete(callId);
    const call = await this.callsRepo.findOne({ where: { id: callId } });
    if (!call || call.state !== CallState.Ringing) return;
    await this.endCall(call, CallEndReason.Missed);
  }

  private async requireCall(callId: string): Promise<Call> {
    const call = await this.callsRepo.findOne({ where: { id: callId } });
    if (!call) {
      throw new AppException(
        AuthErrorCode.CALL_NOT_FOUND,
        'Call not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return call;
  }

  private assertParticipant(call: Call, userId: string) {
    if (call.callerId !== userId && call.calleeId !== userId) {
      throw new AppException(
        AuthErrorCode.CALL_NOT_A_MEMBER,
        'Not a call participant',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private inCallKey(userId: string) {
    return `in_call:${userId}`;
  }

  /**
   * True only if Redis presence points at a still-live call.
   * Clears orphan Redis keys and ends stale ringing/connecting rows
   * (common after deploys — invite timers are in-process only).
   */
  private async hasLiveCall(userId: string): Promise<boolean> {
    const callId = await this.reconcileInCall(userId);
    return !!callId;
  }

  private async reconcileInCall(userId: string): Promise<string | null> {
    const callId = await this.redis.get(this.inCallKey(userId));
    if (!callId) return null;

    const call = await this.callsRepo.findOne({ where: { id: callId } });
    if (!call || call.state === CallState.Ended) {
      await this.redis.del(this.inCallKey(userId));
      return null;
    }

    const ageMs = Date.now() - call.createdAt.getTime();

    if (
      call.state === CallState.Ringing &&
      ageMs > CALL_INVITE_TIMEOUT_MS + 5_000
    ) {
      this.logger.warn(`Stale ringing call ${call.id} — ending as missed`);
      await this.endCall(call, CallEndReason.Missed);
      return null;
    }

    if (
      call.state === CallState.Connecting &&
      ageMs > CALL_CONNECTING_STALE_MS
    ) {
      this.logger.warn(`Stale connecting call ${call.id} — ending as failed`);
      await this.endCall(call, CallEndReason.Failed);
      return null;
    }

    return callId;
  }

  /**
   * Last chat socket gone — end ringing/connecting only.
   * Leave Active alone (tab refresh reconnects; hangup/ICE still owns that).
   */
  async releaseCallsOnDisconnect(userId: string): Promise<void> {
    const callId = await this.reconcileInCall(userId);
    if (!callId) return;
    const call = await this.callsRepo.findOne({ where: { id: callId } });
    if (!call || call.state === CallState.Ended) return;
    if (call.state === CallState.Active) return;

    const reason =
      call.state === CallState.Ringing
        ? userId === call.callerId
          ? CallEndReason.Cancelled
          : CallEndReason.Missed
        : CallEndReason.Failed;
    this.logger.warn(
      `User ${userId} disconnected mid-call ${call.id} — ending as ${reason}`,
    );
    await this.endCall(call, reason);
  }

  private async setInCall(userId: string, callId: string) {
    await this.redis.set(this.inCallKey(userId), callId, CALL_IN_CALL_TTL_SEC);
  }

  private async clearInCall(userId: string, callId: string) {
    const cur = await this.redis.get(this.inCallKey(userId));
    if (cur === callId) {
      await this.redis.del(this.inCallKey(userId));
    }
  }

  private async assertInviteRate(userId: string) {
    const key = `call_invite_rate:${userId}`;
    const n = await this.redis.incr(key);
    if (n === 1) {
      await this.redis.expire(key, CALL_INVITE_RATE_WINDOW_SEC);
    }
    if (n > CALL_INVITE_RATE_LIMIT) {
      throw new AppException(
        AuthErrorCode.CALL_RATE_LIMITED,
        'Too many call invites',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private toDto(call: Call): CallDto {
    return {
      id: call.id,
      conversationId: call.conversationId,
      callerId: call.callerId,
      calleeId: call.calleeId,
      mode: call.mode,
      state: call.state,
      endReason: call.endReason,
      usedTurn: call.usedTurn,
      startedAt: call.startedAt?.toISOString() ?? null,
      endedAt: call.endedAt?.toISOString() ?? null,
      durationSec: call.durationSec,
      createdAt: call.createdAt.toISOString(),
    };
  }
}

/** Exported for tests — HMAC TURN credential check. */
export function verifyTurnCredential(
  secret: string,
  username: string,
  credential: string,
): boolean {
  const expected = createHmac('sha1', secret).update(username).digest('base64');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(credential));
  } catch {
    return false;
  }
}
