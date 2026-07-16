import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import {
  NotificationListFilter,
  ListNotificationsDto,
} from './dto/list-notifications.dto';
import { RegisterPushDeviceDto } from './dto/register-push-device.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-preferences.dto';
import {
  NotificationDelivery,
  NotificationDeliveryStatus,
} from './entities/notification-delivery.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import {
  NotificationSchedule,
  NotificationScheduleStatus,
} from './entities/notification-schedule.entity';
import {
  Notification,
  NotificationCategory,
  NotificationChannel,
  NotificationPriority,
  NotificationType,
} from './entities/notification.entity';
import { PushDevice } from './entities/push-device.entity';
import {
  ACTION_URL_ALLOWLIST,
  DAILY_PUSH_SOFT_CAP,
  TYPE_CATEGORY,
  TYPE_PREFERENCE_GATE,
  type PreferenceToggleId,
} from './notifications.constants';
import {
  decodeCursor,
  encodeCursor,
  toNotificationDto,
  toPreferenceTogglesDto,
  toPreferencesDto,
} from './notifications.serializer';

export type CreateNotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  actionUrl?: string | null;
  payload?: Record<string, unknown> | null;
  sourceEventId?: string | null;
  dedupeKey?: string | null;
  priority?: NotificationPriority;
  expiresAt?: Date | null;
  scheduledAt?: Date | null;
  channels?: NotificationChannel[];
  /** Skip preference gates (system/admin only). */
  force?: boolean;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  /** Wired by ChatGateway afterInit — realtime in-app delivery. */
  emitToUser?: (userId: string, event: string, payload: unknown) => void;

  constructor(
    @InjectRepository(Notification)
    private readonly notificationsRepo: Repository<Notification>,
    @InjectRepository(NotificationPreference)
    private readonly preferencesRepo: Repository<NotificationPreference>,
    @InjectRepository(PushDevice)
    private readonly devicesRepo: Repository<PushDevice>,
    @InjectRepository(NotificationSchedule)
    private readonly schedulesRepo: Repository<NotificationSchedule>,
    @InjectRepository(NotificationDelivery)
    private readonly deliveriesRepo: Repository<NotificationDelivery>,
  ) {}

  async ensurePreferences(userId: string): Promise<NotificationPreference> {
    const existing = await this.preferencesRepo.findOne({ where: { userId } });
    if (existing) return existing;

    return this.preferencesRepo.save(
      this.preferencesRepo.create({
        userId,
        inAppEnabled: true,
        pushEnabled: true,
        emailDigestsEnabled: true,
        learningRemindersEnabled: true,
        weeklyProgressEnabled: true,
        streakRemindersEnabled: true,
        rewardsEnabled: true,
        socialEnabled: true,
        studyTogetherInvitesEnabled: true,
        battleInvitesEnabled: true,
        leagueUpdatesEnabled: true,
        luckyWheelEnabled: true,
        coachMessagesEnabled: true,
        productUpdatesEnabled: false,
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '08:00',
      }),
    );
  }

  async getPreferences(userId: string) {
    const prefs = await this.ensurePreferences(userId);
    return {
      preferences: toPreferencesDto(prefs),
      toggles: toPreferenceTogglesDto(prefs),
    };
  }

  async updatePreferences(
    userId: string,
    dto: UpdateNotificationPreferencesDto,
  ) {
    const prefs = await this.ensurePreferences(userId);

    if (dto.push !== undefined) prefs.pushEnabled = dto.push;
    if (dto.email !== undefined) prefs.emailDigestsEnabled = dto.email;
    if (dto.learningReminders !== undefined) {
      prefs.learningRemindersEnabled = dto.learningReminders;
    }
    if (dto.weeklyProgress !== undefined) {
      prefs.weeklyProgressEnabled = dto.weeklyProgress;
    }
    if (dto.streakReminders !== undefined) {
      prefs.streakRemindersEnabled = dto.streakReminders;
    }
    if (dto.rewards !== undefined) prefs.rewardsEnabled = dto.rewards;
    if (dto.social !== undefined) prefs.socialEnabled = dto.social;
    if (dto.studyTogetherInvites !== undefined) {
      prefs.studyTogetherInvitesEnabled = dto.studyTogetherInvites;
    }
    if (dto.battleInvites !== undefined) {
      prefs.battleInvitesEnabled = dto.battleInvites;
    }
    if (dto.leagueUpdates !== undefined) {
      prefs.leagueUpdatesEnabled = dto.leagueUpdates;
    }
    if (dto.luckyWheel !== undefined) {
      prefs.luckyWheelEnabled = dto.luckyWheel;
    }
    if (dto.coachMessages !== undefined) {
      prefs.coachMessagesEnabled = dto.coachMessages;
    }
    if (dto.marketing !== undefined) {
      prefs.productUpdatesEnabled = dto.marketing;
    }
    if (dto.quietHoursEnabled !== undefined) {
      prefs.quietHoursEnabled = dto.quietHoursEnabled;
    }
    if (dto.quietHoursStart !== undefined) {
      prefs.quietHoursStart = dto.quietHoursStart;
    }
    if (dto.quietHoursEnd !== undefined) {
      prefs.quietHoursEnd = dto.quietHoursEnd;
    }
    if (dto.timezone !== undefined) {
      prefs.timezoneSnapshot = dto.timezone;
    }

    const saved = await this.preferencesRepo.save(prefs);
    return {
      preferences: toPreferencesDto(saved),
      toggles: toPreferenceTogglesDto(saved),
    };
  }

  async list(userId: string, query: ListNotificationsDto) {
    const filter = query.filter ?? NotificationListFilter.All;
    const limit = query.limit ?? 50;
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && !cursor) {
      throw new AppException(
        AuthErrorCode.NOTIFICATION_INVALID_CURSOR,
        'Invalid notification cursor',
        HttpStatus.BAD_REQUEST,
      );
    }

    const qb = this.notificationsRepo
      .createQueryBuilder('n')
      .where('n.user_id = :userId', { userId })
      .andWhere('n.hidden_at IS NULL')
      .andWhere('(n.expires_at IS NULL OR n.expires_at > NOW())')
      .orderBy('n.created_at', 'DESC')
      .addOrderBy('n.id', 'DESC')
      .take(limit + 1);

    if (cursor) {
      qb.andWhere(
        '(n.created_at < :cAt OR (n.created_at = :cAt AND n.id < :cId))',
        { cAt: cursor.createdAt, cId: cursor.id },
      );
    } else if ((query.offset ?? 0) > 0) {
      qb.skip(query.offset);
    }

    this.applyListFilter(qb, filter);

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const unreadCount = await this.countUnread(userId);
    const nextCursor =
      hasMore && page.length > 0
        ? encodeCursor(
            page[page.length - 1].createdAt,
            page[page.length - 1].id,
          )
        : null;

    return {
      items: page.map(toNotificationDto),
      total: page.length,
      unreadCount,
      limit,
      offset: query.offset ?? 0,
      nextCursor,
    };
  }

  private applyListFilter(
    qb: ReturnType<Repository<Notification>['createQueryBuilder']>,
    filter: NotificationListFilter,
  ) {
    if (filter === NotificationListFilter.Unread) {
      qb.andWhere('n.read_at IS NULL');
    } else if (filter === NotificationListFilter.Rewards) {
      qb.andWhere('n.category = :category', {
        category: NotificationCategory.Rewards,
      });
    } else if (filter === NotificationListFilter.Social) {
      qb.andWhere('n.category = :category', {
        category: NotificationCategory.Social,
      });
    } else if (filter === NotificationListFilter.Learning) {
      qb.andWhere('n.category = :category', {
        category: NotificationCategory.Learning,
      });
    } else if (filter === NotificationListFilter.Coach) {
      qb.andWhere('n.category = :category', {
        category: NotificationCategory.Coach,
      });
    } else if (filter === NotificationListFilter.System) {
      qb.andWhere('n.category = :category', {
        category: NotificationCategory.System,
      });
    }
  }

  countUnread(userId: string): Promise<number> {
    return this.notificationsRepo
      .createQueryBuilder('n')
      .where('n.user_id = :userId', { userId })
      .andWhere('n.read_at IS NULL')
      .andWhere('n.hidden_at IS NULL')
      .andWhere('(n.expires_at IS NULL OR n.expires_at > NOW())')
      .getCount();
  }

  private async emitUnread(userId: string) {
    if (!this.emitToUser) return;
    const unreadCount = await this.countUnread(userId);
    this.emitToUser(userId, 'notification.unread', { unreadCount });
  }

  /**
   * Cancel pending notification_schedules whose dedupe_key starts with prefix.
   * Used by Course Timing replan to drop stale slot reminders.
   */
  async cancelScheduledByDedupePrefix(
    userId: string,
    prefix: string,
    reason: string,
  ): Promise<number> {
    const rows = await this.schedulesRepo
      .createQueryBuilder('s')
      .where('s.user_id = :userId', { userId })
      .andWhere('s.dedupe_key LIKE :prefix', { prefix: `${prefix}%` })
      .andWhere('s.status IN (:...statuses)', {
        statuses: [
          NotificationScheduleStatus.Scheduled,
          NotificationScheduleStatus.Queued,
        ],
      })
      .getMany();
    if (!rows.length) return 0;
    for (const row of rows) {
      row.status = NotificationScheduleStatus.Cancelled;
      row.cancellationReason = reason;
    }
    await this.schedulesRepo.save(rows);
    return rows.length;
  }

  async markRead(userId: string, notificationId: string, unread = false) {
    const notification = await this.findOwnedVisible(userId, notificationId);

    if (unread) {
      notification.readAt = null;
    } else if (!notification.readAt) {
      notification.readAt = new Date();
    }
    await this.notificationsRepo.save(notification);
    void this.emitUnread(userId);
    return toNotificationDto(notification);
  }

  async markAllRead(userId: string, category?: NotificationCategory) {
    const qb = this.notificationsRepo
      .createQueryBuilder()
      .update(Notification)
      .set({ readAt: new Date() })
      .where('user_id = :userId', { userId })
      .andWhere('read_at IS NULL')
      .andWhere('hidden_at IS NULL');

    if (category) {
      qb.andWhere('category = :category', { category });
    }

    const result = await qb.execute();
    void this.emitUnread(userId);
    return { updated: result.affected ?? 0 };
  }

  async hide(userId: string, notificationId: string) {
    const notification = await this.findOwnedVisible(userId, notificationId);
    notification.hiddenAt = new Date();
    if (!notification.readAt) notification.readAt = new Date();
    await this.notificationsRepo.save(notification);
    void this.emitUnread(userId);
    return { ok: true };
  }

  async registerDevice(userId: string, dto: RegisterPushDeviceDto) {
    let device = await this.devicesRepo.findOne({
      where: { userId, deviceId: dto.deviceId },
    });
    if (!device) {
      device = this.devicesRepo.create({
        userId,
        deviceId: dto.deviceId,
        platform: dto.platform,
        token: dto.token,
        endpoint: dto.endpoint ?? null,
      });
    } else {
      device.platform = dto.platform;
      device.token = dto.token;
      device.endpoint = dto.endpoint ?? device.endpoint;
      device.revokedAt = null;
    }
    device.lastSeenAt = new Date();
    const saved = await this.devicesRepo.save(device);
    return {
      id: saved.id,
      deviceId: saved.deviceId,
      platform: saved.platform,
      lastSeenAt: saved.lastSeenAt?.toISOString() ?? null,
    };
  }

  async revokeDevice(userId: string, deviceRowId: string) {
    const device = await this.devicesRepo.findOne({
      where: { id: deviceRowId, userId },
    });
    if (!device || device.revokedAt) {
      throw new AppException(
        AuthErrorCode.NOTIFICATION_DEVICE_NOT_FOUND,
        'Push device not found',
        HttpStatus.NOT_FOUND,
      );
    }
    device.revokedAt = new Date();
    await this.devicesRepo.save(device);
    return { ok: true };
  }

  /**
   * Create a notification for a user. Respects preference gates, dedupe,
   * actionUrl allowlist, quiet hours (push delay), and delivery stubs.
   */
  async create(input: CreateNotificationInput): Promise<Notification | null> {
    const prefs = await this.ensurePreferences(input.userId);
    const prefMap = toPreferencesDto(prefs);
    const priority = input.priority ?? NotificationPriority.Normal;

    if (!input.force) {
      const gate = TYPE_PREFERENCE_GATE[input.type];
      if (gate && !prefMap[gate]) {
        this.logger.debug(
          `Skip ${input.type} for user=${input.userId}: pref ${gate}=false`,
        );
        return null;
      }
    }

    if (input.sourceEventId) {
      const bySource = await this.notificationsRepo.findOne({
        where: {
          userId: input.userId,
          sourceEventId: input.sourceEventId,
          type: input.type,
        },
      });
      if (bySource) return bySource;
    }

    if (input.dedupeKey) {
      const byDedupe = await this.notificationsRepo.findOne({
        where: { userId: input.userId, dedupeKey: input.dedupeKey },
      });
      if (byDedupe) return byDedupe;
    }

    const actionUrl = this.sanitizeActionUrl(input.actionUrl);
    const requested = input.channels ?? [NotificationChannel.InApp];
    const deliveredChannels: NotificationChannel[] = [];

    const wantsInApp = requested.includes(NotificationChannel.InApp);
    const wantsPush = requested.includes(NotificationChannel.Push);
    const wantsEmail = requested.includes(NotificationChannel.Email);

    if (wantsInApp) {
      deliveredChannels.push(NotificationChannel.InApp);
    }

    const inQuietHours =
      prefs.quietHoursEnabled &&
      priority !== NotificationPriority.Critical &&
      input.type !== NotificationType.Security &&
      this.isInQuietHours(prefs);

    const pushCapReached =
      wantsPush && (await this.pushCapReached(input.userId, input.type));

    let pushDeferred = false;
    if (wantsPush && (input.force || prefMap.push)) {
      if (inQuietHours || pushCapReached) {
        pushDeferred = true;
      } else {
        deliveredChannels.push(NotificationChannel.Push);
        this.logger.log(
          `[PUSH stub] user=${input.userId} type=${input.type} title="${input.title}"`,
        );
      }
    }

    if (wantsEmail && (input.force || prefMap.email)) {
      if (inQuietHours) {
        // defer email similarly via schedule path
      } else {
        deliveredChannels.push(NotificationChannel.Email);
        this.logger.log(
          `[EMAIL stub] user=${input.userId} type=${input.type} title="${input.title}"`,
        );
      }
    }

    if (
      deliveredChannels.length === 0 &&
      !pushDeferred &&
      !deliveredChannels.includes(NotificationChannel.InApp)
    ) {
      return null;
    }

    if (!deliveredChannels.includes(NotificationChannel.InApp) && wantsInApp) {
      deliveredChannels.push(NotificationChannel.InApp);
    }

    if (!deliveredChannels.includes(NotificationChannel.InApp)) {
      // External-only: still schedule if deferred
      if (pushDeferred || input.scheduledAt) {
        await this.upsertSchedule(input, prefs, 'push_deferred');
      }
      return null;
    }

    let notification: Notification;
    try {
      notification = await this.notificationsRepo.save(
        this.notificationsRepo.create({
          userId: input.userId,
          type: input.type,
          category: TYPE_CATEGORY[input.type],
          title: input.title.slice(0, 160),
          body: input.body.slice(0, 500),
          actionUrl,
          payload: input.payload ?? null,
          sourceEventId: input.sourceEventId ?? null,
          dedupeKey: input.dedupeKey ?? null,
          priority,
          channels: deliveredChannels,
          expiresAt: input.expiresAt ?? null,
          readAt: null,
          hiddenAt: null,
        }),
      );
    } catch (err) {
      // Unique violation on dedupe/source — return existing
      if (input.dedupeKey) {
        const existing = await this.notificationsRepo.findOne({
          where: { userId: input.userId, dedupeKey: input.dedupeKey },
        });
        if (existing) return existing;
      }
      if (input.sourceEventId) {
        const existing = await this.notificationsRepo.findOne({
          where: {
            userId: input.userId,
            sourceEventId: input.sourceEventId,
            type: input.type,
          },
        });
        if (existing) return existing;
      }
      throw err;
    }

    for (const channel of deliveredChannels) {
      await this.deliveriesRepo.save(
        this.deliveriesRepo.create({
          notificationId: notification.id,
          channel,
          provider: 'stub',
          status:
            channel === NotificationChannel.InApp
              ? NotificationDeliveryStatus.Delivered
              : NotificationDeliveryStatus.Sent,
          attempts: 1,
          deliveredAt:
            channel === NotificationChannel.InApp ? new Date() : null,
        }),
      );
    }

    if (pushDeferred || input.scheduledAt) {
      await this.upsertSchedule(
        input,
        prefs,
        pushDeferred ? 'quiet_hours' : 'scheduled',
        notification.id,
      );
      await this.deliveriesRepo.save(
        this.deliveriesRepo.create({
          notificationId: notification.id,
          channel: NotificationChannel.Push,
          provider: 'stub',
          status: NotificationDeliveryStatus.Skipped,
          attempts: 0,
          failureCode: pushDeferred
            ? inQuietHours
              ? 'QUIET_HOURS'
              : 'DAILY_CAP'
            : 'SCHEDULED',
        }),
      );
    }

    if (deliveredChannels.includes(NotificationChannel.InApp) && this.emitToUser) {
      const unreadCount = await this.countUnread(input.userId);
      this.emitToUser(input.userId, 'notification.new', {
        notification: toNotificationDto(notification),
        unreadCount,
      });
    }

    return notification;
  }

  /**
   * Fan-in from gamification outbox (lesson/reward/week events).
   */
  async handleDomainOutbox(event: {
    id: string;
    type: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const userId = String(event.payload.userId ?? '');
    if (!userId) return;

    if (
      event.type === 'reward.granted.v1' ||
      event.type === 'gamification.reward.v1'
    ) {
      const xp = Number(event.payload.xp ?? event.payload.lifetimeXp ?? 0);
      const gems = Number(event.payload.gems ?? 0);
      const coins = Number(event.payload.coins ?? 0);
      const parts: string[] = [];
      if (xp > 0) parts.push(`+${xp} XP`);
      if (gems > 0) parts.push(`+${gems} gems`);
      if (coins > 0) parts.push(`+${coins} coins`);
      if (parts.length === 0) return;

      await this.create({
        userId,
        type: NotificationType.RewardGranted,
        title: 'Reward granted',
        body: parts.join(' · '),
        actionUrl: '/rewards',
        sourceEventId: event.id,
        dedupeKey: `reward_granted:${event.id}`,
        payload: event.payload,
        channels: [NotificationChannel.InApp],
      });
      return;
    }

    if (event.type === 'lesson.completed.v1') {
      const lessonTitle = String(
        event.payload.lessonTitle ?? event.payload.title ?? 'Lesson',
      );
      await this.create({
        userId,
        type: NotificationType.System,
        title: 'Lesson complete',
        body: `${lessonTitle} is done. Keep the streak going.`,
        actionUrl: '/learn',
        sourceEventId: event.id,
        dedupeKey: `lesson_completed:${event.id}`,
        payload: event.payload,
        channels: [NotificationChannel.InApp],
      });
      return;
    }

    if (event.type === 'week.sealed.v1') {
      await this.create({
        userId,
        type: NotificationType.WeeklyRecap,
        title: 'Week sealed',
        body: 'Nice work — your week is locked in. Review the recap.',
        actionUrl: '/week',
        sourceEventId: event.id,
        dedupeKey: `week_sealed:${event.id}`,
        payload: event.payload,
        channels: [NotificationChannel.InApp, NotificationChannel.Push],
        priority: NotificationPriority.High,
      });
    }
  }

  /** Helper for other modules — preference check without creating. */
  async isAllowed(
    userId: string,
    toggle: PreferenceToggleId,
  ): Promise<boolean> {
    const prefs = await this.ensurePreferences(userId);
    const map = toPreferencesDto(prefs);
    return Boolean(map[toggle]);
  }

  private async findOwnedVisible(userId: string, notificationId: string) {
    const notification = await this.notificationsRepo.findOne({
      where: { id: notificationId, userId, hiddenAt: IsNull() },
    });
    if (!notification) {
      throw new AppException(
        AuthErrorCode.NOTIFICATION_NOT_FOUND,
        'Notification not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return notification;
  }

  private sanitizeActionUrl(raw?: string | null): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed.startsWith('/')) {
      throw new AppException(
        AuthErrorCode.NOTIFICATION_ACTION_URL_INVALID,
        'actionUrl must be an allowlisted app path',
        HttpStatus.BAD_REQUEST,
      );
    }
    const pathOnly = trimmed.split('?')[0].split('#')[0];
    const ok = ACTION_URL_ALLOWLIST.some(
      (prefix) => pathOnly === prefix || pathOnly.startsWith(`${prefix}/`),
    );
    if (!ok) {
      throw new AppException(
        AuthErrorCode.NOTIFICATION_ACTION_URL_INVALID,
        'actionUrl is not allowlisted',
        HttpStatus.BAD_REQUEST,
      );
    }
    return trimmed.slice(0, 512);
  }

  private isInQuietHours(prefs: NotificationPreference): boolean {
    const tz = prefs.timezoneSnapshot || 'UTC';
    let localMinutes: number;
    try {
      const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const parts = fmt.formatToParts(new Date());
      const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
      const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
      localMinutes = hour * 60 + minute;
    } catch {
      const now = new Date();
      localMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    }

    const start = this.parseHm(prefs.quietHoursStart);
    const end = this.parseHm(prefs.quietHoursEnd);
    if (start === end) return false;
    if (start < end) {
      return localMinutes >= start && localMinutes < end;
    }
    // wraps midnight
    return localMinutes >= start || localMinutes < end;
  }

  private parseHm(hm: string): number {
    const [h, m] = hm.split(':').map((x) => Number(x));
    return (h || 0) * 60 + (m || 0);
  }

  private async pushCapReached(
    userId: string,
    type: NotificationType,
  ): Promise<boolean> {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);

    const pushToday = await this.deliveriesRepo
      .createQueryBuilder('d')
      .innerJoin('d.notification', 'n')
      .where('n.user_id = :userId', { userId })
      .andWhere('d.channel = :channel', { channel: NotificationChannel.Push })
      .andWhere('d.status IN (:...statuses)', {
        statuses: [
          NotificationDeliveryStatus.Sent,
          NotificationDeliveryStatus.Delivered,
        ],
      })
      .andWhere('d.created_at >= :since', { since })
      .getCount();

    if (pushToday >= DAILY_PUSH_SOFT_CAP) return true;

    if (type === NotificationType.StreakRisk) {
      const streak = await this.deliveriesRepo
        .createQueryBuilder('d')
        .innerJoin('d.notification', 'n')
        .where('n.user_id = :userId', { userId })
        .andWhere('n.type = :type', { type: NotificationType.StreakRisk })
        .andWhere('d.channel = :channel', {
          channel: NotificationChannel.Push,
        })
        .andWhere('d.status IN (:...statuses)', {
          statuses: [
            NotificationDeliveryStatus.Sent,
            NotificationDeliveryStatus.Delivered,
          ],
        })
        .andWhere('d.created_at >= :since', { since })
        .getCount();
      if (streak >= 1) return true;
    }

    return false;
  }

  private async upsertSchedule(
    input: CreateNotificationInput,
    prefs: NotificationPreference,
    reason: string,
    notificationId?: string,
  ) {
    const scheduledAt = input.scheduledAt ?? this.nextQuietHoursEnd(prefs);
    const dedupeKey =
      input.dedupeKey != null
        ? `sched:${input.dedupeKey}`
        : `sched:${input.type}:${input.userId}:${scheduledAt.toISOString()}`;

    const existing = await this.schedulesRepo.findOne({
      where: { userId: input.userId, dedupeKey },
    });
    if (existing) return existing;

    return this.schedulesRepo.save(
      this.schedulesRepo.create({
        userId: input.userId,
        type: input.type,
        topic: reason,
        scheduledAt,
        timezoneSnapshot: prefs.timezoneSnapshot,
        scheduleVersion: 1,
        sourceEntityId: notificationId ?? input.sourceEventId ?? null,
        dedupeKey,
        status: NotificationScheduleStatus.Scheduled,
        payload: {
          title: input.title,
          body: input.body,
          actionUrl: input.actionUrl ?? null,
          ...(input.payload ?? {}),
        },
      }),
    );
  }

  private nextQuietHoursEnd(prefs: NotificationPreference): Date {
    const endParts = prefs.quietHoursEnd.split(':').map(Number);
    const endH = endParts[0] ?? 8;
    const endM = endParts[1] ?? 0;
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(endH, endM, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
}
