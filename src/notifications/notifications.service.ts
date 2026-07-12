import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import {
  NotificationListFilter,
  ListNotificationsDto,
} from './dto/list-notifications.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-preferences.dto';
import { NotificationPreference } from './entities/notification-preference.entity';
import {
  Notification,
  NotificationCategory,
  NotificationChannel,
  NotificationType,
} from './entities/notification.entity';
import {
  TYPE_CATEGORY,
  TYPE_PREFERENCE_GATE,
  type PreferenceToggleId,
} from './notifications.constants';
import {
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
  /** Channels to attempt. In-app always attempted when allowed by prefs. */
  channels?: NotificationChannel[];
  /** Skip preference gates (system/admin only). */
  force?: boolean;
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationsRepo: Repository<Notification>,
    @InjectRepository(NotificationPreference)
    private readonly preferencesRepo: Repository<NotificationPreference>,
  ) {}

  async ensurePreferences(userId: string): Promise<NotificationPreference> {
    const existing = await this.preferencesRepo.findOne({ where: { userId } });
    if (existing) return existing;

    return this.preferencesRepo.save(
      this.preferencesRepo.create({
        userId,
        pushEnabled: true,
        emailDigestsEnabled: true,
        streakRemindersEnabled: true,
        battleInvitesEnabled: true,
        productUpdatesEnabled: false,
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
    if (dto.streakReminders !== undefined) {
      prefs.streakRemindersEnabled = dto.streakReminders;
    }
    if (dto.battleInvites !== undefined) {
      prefs.battleInvitesEnabled = dto.battleInvites;
    }
    if (dto.marketing !== undefined) {
      prefs.productUpdatesEnabled = dto.marketing;
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
    const offset = query.offset ?? 0;

    const qb = this.notificationsRepo
      .createQueryBuilder('n')
      .where('n.user_id = :userId', { userId })
      .orderBy('n.created_at', 'DESC')
      .take(limit)
      .skip(offset);

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
    }

    const [items, total] = await qb.getManyAndCount();
    const unreadCount = await this.countUnread(userId);

    return {
      items: items.map(toNotificationDto),
      total,
      unreadCount,
      limit,
      offset,
    };
  }

  countUnread(userId: string): Promise<number> {
    return this.notificationsRepo.count({
      where: { userId, readAt: IsNull() },
    });
  }

  async markRead(userId: string, notificationId: string) {
    const notification = await this.notificationsRepo.findOne({
      where: { id: notificationId, userId },
    });
    if (!notification) {
      throw new AppException(
        AuthErrorCode.NOTIFICATION_NOT_FOUND,
        'Notification not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.notificationsRepo.save(notification);
    }

    return toNotificationDto(notification);
  }

  async markAllRead(userId: string) {
    const result = await this.notificationsRepo.update(
      { userId, readAt: IsNull() },
      { readAt: new Date() },
    );
    return { updated: result.affected ?? 0 };
  }

  /**
   * Create a notification for a user. Respects preference gates.
   * Returns null when blocked by prefs (not an error).
   */
  async create(
    input: CreateNotificationInput,
  ): Promise<Notification | null> {
    const prefs = await this.ensurePreferences(input.userId);
    const prefMap = toPreferencesDto(prefs);

    if (!input.force) {
      const gate = TYPE_PREFERENCE_GATE[input.type];
      if (gate && !prefMap[gate]) {
        this.logger.debug(
          `Skip ${input.type} for user=${input.userId}: pref ${gate}=false`,
        );
        return null;
      }
    }

    const requested = input.channels ?? [NotificationChannel.InApp];
    const deliveredChannels: NotificationChannel[] = [];

    const wantsInApp = requested.includes(NotificationChannel.InApp);
    const wantsPush = requested.includes(NotificationChannel.Push);
    const wantsEmail = requested.includes(NotificationChannel.Email);

    if (wantsInApp) {
      deliveredChannels.push(NotificationChannel.InApp);
    }

    if (wantsPush && (input.force || prefMap.push)) {
      deliveredChannels.push(NotificationChannel.Push);
      this.logger.log(
        `[PUSH stub] user=${input.userId} type=${input.type} title="${input.title}"`,
      );
    }

    if (wantsEmail && (input.force || prefMap.email)) {
      deliveredChannels.push(NotificationChannel.Email);
      this.logger.log(
        `[EMAIL stub] user=${input.userId} type=${input.type} title="${input.title}"`,
      );
    }

    if (deliveredChannels.length === 0) {
      return null;
    }

    // Persist only when in-app is among delivered channels.
    if (!deliveredChannels.includes(NotificationChannel.InApp)) {
      return null;
    }

    const notification = await this.notificationsRepo.save(
      this.notificationsRepo.create({
        userId: input.userId,
        type: input.type,
        category: TYPE_CATEGORY[input.type],
        title: input.title.slice(0, 160),
        body: input.body.slice(0, 500),
        actionUrl: input.actionUrl ?? null,
        payload: input.payload ?? null,
        channels: deliveredChannels,
        readAt: null,
      }),
    );

    return notification;
  }

  /** Helper for other modules — preference check without creating. */
  async isAllowed(
    userId: string,
    toggle: PreferenceToggleId,
  ): Promise<boolean> {
    const prefs = await this.ensurePreferences(userId);
    return toPreferencesDto(prefs)[toggle];
  }
}
