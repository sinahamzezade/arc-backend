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
import { ProfilesService } from '../profiles/profiles.service';
import { SocialPermissionService } from '../social/social-permission.service';
import { UsersService } from '../users/users.service';
import { SystemFlagKey } from '../system-flags/system-flag.keys';
import { SystemFlagsService } from '../system-flags/system-flags.service';
import {
  CALL_CONNECTING_STALE_MS,
  CALL_DISCONNECT_GRACE_MS,
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
  /** userId → pending end after last socket disconnect */
  private readonly disconnectGraceTimers = new Map<string, NodeJS.Timeout>();

  /** Wired by ChatGateway afterInit */
  emitToUser?: (userId: string, event: string, payload: unknown) => void;

  constructor(
    @InjectRepository(Call)
    private readonly callsRepo: Repository<Call>,
    @Inject(forwardRef(() => ChatService))
    private readonly chat: ChatService,
    private readonly permissions: SocialPermissionService,
    private readonly users: UsersService,
    private readonly profiles: ProfilesService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly systemFlags: SystemFlagsService,
  ) {}

  private async assertCallModeEnabled(
    userId: string,
    mode: CallMode,
  ): Promise<void> {
    if (mode === CallMode.Video) {
      const on = await this.systemFlags.getBool(
        SystemFlagKey.VIDEO_CALL_ENABLED,
        true,
        userId,
      );
      if (!on) {
        throw new AppException(
          AuthErrorCode.CALL_NOT_ALLOWED,
          'Video calls are disabled',
          HttpStatus.FORBIDDEN,
        );
      }
      return;
    }
    const on = await this.systemFlags.getBool(
      SystemFlagKey.VOICE_CALL_ENABLED,
      true,
      userId,
    );
    if (!on) {
      throw new AppException(
        AuthErrorCode.CALL_NOT_ALLOWED,
        'Voice calls are disabled',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  async getIceServers(userId: string): Promise<IceServersResponse> {
    const isProd = this.config.get<string>('NODE_ENV') === 'production';

    // Preferred for managed TURN (Metered / Open Relay dashboard API key).
    const metered = await this.fetchMeteredIceServers();
    if (metered) {
      return { iceServers: metered, ttlSec: CALL_TURN_TTL_SEC };
    }

    const stunRaw =
      this.config.get<string>('STUN_URLS') ||
      this.config.get<string>('TURN_STUN_URLS') ||
      'stun:stun.l.google.com:19302';
    const stunUrls = new Set(
      stunRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    // Always keep a public STUN fallback (dev coturn may be unreachable from WAN).
    stunUrls.add('stun:stun.l.google.com:19302');

    const iceServers: IceServersResponse['iceServers'] = [...stunUrls].map(
      (urls) => ({ urls }),
    );

    const turnRaw =
      this.config.get<string>('TURN_URLS') ||
      this.config.get<string>('TURN_URIS');
    const turnUrls = (turnRaw || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((url) => {
        const isLoopback = /localhost|127\.0\.0\.1/.test(url);
        if (isProd && isLoopback) {
          this.logger.warn(`Skipping loopback TURN URL in production: ${url}`);
          return false;
        }
        return true;
      });

    // Static username/password (some managed TURN dashboards).
    const staticUser = this.config.get<string>('TURN_USERNAME')?.trim();
    const staticPass = this.config.get<string>('TURN_CREDENTIAL')?.trim();
    if (staticUser && staticPass && turnUrls.length > 0) {
      iceServers.push({
        urls: turnUrls.length === 1 ? turnUrls[0] : turnUrls,
        username: staticUser,
        credential: staticPass,
        credentialType: 'password',
      });
      return { iceServers, ttlSec: CALL_TURN_TTL_SEC };
    }

    // Coturn / Open Relay staticauth — time-limited HMAC (use-auth-secret).
    const secret = this.config.get<string>('TURN_SHARED_SECRET');
    if (secret && turnUrls.length > 0) {
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
    } else if (isProd) {
      this.logger.warn(
        'No TURN configured — set TURN_METERED_API_URL+KEY, or TURN_SHARED_SECRET+TURN_URLS (Open Relay staticauth / coturn)',
      );
    }

    return { iceServers, ttlSec: CALL_TURN_TTL_SEC };
  }

  /**
   * Metered / Open Relay REST → iceServers array.
   * TURN_METERED_API_URL e.g. https://<app>.metered.live/api/v1/turn/credentials
   */
  private async fetchMeteredIceServers(): Promise<
    IceServersResponse['iceServers'] | null
  > {
    const base = this.config.get<string>('TURN_METERED_API_URL')?.trim();
    const apiKey = this.config.get<string>('TURN_METERED_API_KEY')?.trim();
    if (!base || !apiKey) return null;

    const url = new URL(base);
    if (!url.searchParams.has('apiKey')) {
      url.searchParams.set('apiKey', apiKey);
    }

    try {
      const res = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4_000),
      });
      if (!res.ok) {
        this.logger.warn(`Metered TURN API HTTP ${res.status}`);
        return null;
      }
      const data = (await res.json()) as unknown;
      const list = Array.isArray(data)
        ? data
        : Array.isArray((data as { iceServers?: unknown }).iceServers)
          ? (data as { iceServers: unknown[] }).iceServers
          : null;
      if (!list || list.length === 0) {
        this.logger.warn('Metered TURN API returned empty iceServers');
        return null;
      }
      return list as IceServersResponse['iceServers'];
    } catch (err) {
      this.logger.warn(
        `Metered TURN API failed: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
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
    await this.assertCallModeEnabled(callerId, input.mode);
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

    if (!(await this.permissions.canReceiveCall(peerId, input.mode))) {
      throw new AppException(
        AuthErrorCode.CALL_NOT_ALLOWED,
        input.mode === CallMode.Video
          ? 'Peer has video calls disabled'
          : 'Peer has voice calls disabled',
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

    const callerProfile = await this.profiles.findByUserId(callerId);
    const fromName =
      callerProfile?.displayName?.trim() ||
      callerProfile?.username?.trim() ||
      'Someone';

    const incoming = {
      callId: call.id,
      conversationId: call.conversationId,
      fromUserId: callerId,
      fromName,
      mode: call.mode,
    };

    this.emitToUser?.(peerId, 'call.incoming', incoming);

    void this.notifications
      .create({
        userId: peerId,
        type: NotificationType.IncomingCall,
        title: fromName,
        body:
          call.mode === CallMode.Video
            ? 'Incoming video call'
            : 'Incoming voice call',
        actionUrl: `/chat/${call.conversationId}?call=${call.id}`,
        payload: {
          callId: call.id,
          conversationId: call.conversationId,
          fromUserId: callerId,
          fromName,
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
    await this.assertCallModeEnabled(userId, mode);
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
    if (mode === CallMode.Video) {
      if (!(await this.permissions.canReceiveCall(peerId, CallMode.Video))) {
        throw new AppException(
          AuthErrorCode.CALL_NOT_ALLOWED,
          'Peer has video calls disabled',
          HttpStatus.FORBIDDEN,
        );
      }
      call.mode = CallMode.Video;
      await this.callsRepo.save(call);
    }
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
   * Last chat socket gone — arm grace, then end ringing/connecting only.
   * Leave Active alone (tab refresh reconnects; hangup/ICE still owns that).
   * Grace cancels on reconnect (see cancelDisconnectRelease).
   */
  releaseCallsOnDisconnect(userId: string): void {
    this.clearDisconnectGrace(userId);
    const t = setTimeout(() => {
      this.disconnectGraceTimers.delete(userId);
      void this.releaseCallsAfterGrace(userId);
    }, CALL_DISCONNECT_GRACE_MS);
    this.disconnectGraceTimers.set(userId, t);
  }

  /** New socket for user — keep ringing/connecting alive. */
  cancelDisconnectRelease(userId: string): void {
    this.clearDisconnectGrace(userId);
  }

  private clearDisconnectGrace(userId: string) {
    const t = this.disconnectGraceTimers.get(userId);
    if (t) {
      clearTimeout(t);
      this.disconnectGraceTimers.delete(userId);
    }
  }

  private async releaseCallsAfterGrace(userId: string): Promise<void> {
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
      `User ${userId} still offline after grace — ending call ${call.id} as ${reason}`,
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
