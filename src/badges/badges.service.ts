import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import {
  RewardCurrency,
  RewardReasonType,
} from '../gamification/entities/reward-ledger-entry.entity';
import { OUTBOX_LESSON_COMPLETED, OUTBOX_WEEK_SEALED } from '../gamification/reward-constants';
import { RewardLedgerService } from '../gamification/reward-ledger.service';
import { OutboxService } from '../gamification/outbox.service';
import {
  NotificationChannel,
  NotificationType,
} from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { LessonProgress } from '../roadmaps/entities/lesson-progress.entity';
import { LessonProgressStatus } from '../roadmaps/entities/lesson-progress.entity';
import {
  BADGE_CORE_TOTAL,
  BADGE_FEATURED_MAX,
  BadgeCriteriaType,
  BadgeDefinitionStatus,
  OUTBOX_BADGE_UNLOCKED,
  OUTBOX_BATTLE_COMPLETED,
  OUTBOX_REFERRAL_MILESTONE,
  OUTBOX_STUDY_COMPLETED,
  UserBadgeStatus,
} from './badge.constants';
import { BadgeDefinition } from './entities/badge-definition.entity';
import { BadgeFeaturedSlot } from './entities/badge-featured-slot.entity';
import { BadgeUnlockEvent } from './entities/badge-unlock-event.entity';
import { BadgeUserSettings } from './entities/badge-user-settings.entity';
import { UserBadge } from './entities/user-badge.entity';
import { UserBadgeProgress } from './entities/user-badge-progress.entity';

type DomainEvent = {
  id?: string;
  type: string;
  payload: Record<string, unknown>;
};

@Injectable()
export class BadgesService {
  private readonly logger = new Logger(BadgesService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: RewardLedgerService,
    private readonly outbox: OutboxService,
    @InjectRepository(BadgeDefinition)
    private readonly defsRepo: Repository<BadgeDefinition>,
    @InjectRepository(UserBadge)
    private readonly userBadgesRepo: Repository<UserBadge>,
    @InjectRepository(UserBadgeProgress)
    private readonly progressRepo: Repository<UserBadgeProgress>,
    @InjectRepository(BadgeFeaturedSlot)
    private readonly featuredRepo: Repository<BadgeFeaturedSlot>,
    @InjectRepository(BadgeUserSettings)
    private readonly settingsRepo: Repository<BadgeUserSettings>,
    @InjectRepository(BadgeUnlockEvent)
    private readonly unlockEventsRepo: Repository<BadgeUnlockEvent>,
    @InjectRepository(LessonProgress)
    private readonly lessonProgressRepo: Repository<LessonProgress>,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async listCatalog() {
    const defs = await this.activeDefs();
    return {
      totalCore: BADGE_CORE_TOTAL,
      items: defs.map((d) => this.serializeDef(d)),
    };
  }

  async getByCode(code: string) {
    const def = await this.defsRepo.findOne({ where: { code } });
    if (!def || def.status === BadgeDefinitionStatus.Draft) {
      throw new AppException(
        AuthErrorCode.BADGE_NOT_FOUND,
        'Badge not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.serializeDef(def);
  }

  async getMyBadges(userId: string) {
    const [defs, earned, progressRows, featured, settings] = await Promise.all([
      this.activeDefs(),
      this.userBadgesRepo.find({
        where: { userId, status: UserBadgeStatus.Earned },
      }),
      this.progressRepo.find({ where: { userId } }),
      this.featuredRepo.find({
        where: { userId },
        order: { slotIndex: 'ASC' },
      }),
      this.ensureSettings(userId),
    ]);

    const earnedBy = new Map(earned.map((e) => [e.badgeId, e]));
    const progressBy = new Map(progressRows.map((p) => [p.badgeCode, p]));

    const badges = defs.map((d) => {
      const row = earnedBy.get(d.code);
      const prog = progressBy.get(d.code);
      const status = row
        ? 'earned'
        : prog && prog.currentValue > 0
          ? 'in_progress'
          : 'locked';
      return {
        ...this.serializeDef(d),
        status,
        earnedAt: row?.earnedAt?.toISOString() ?? row?.unlockedAt?.toISOString() ?? null,
        progress: {
          current: prog?.currentValue ?? (row ? d.criteriaJson.target ?? 1 : 0),
          target: prog?.targetValue ?? d.criteriaJson.target ?? d.criteriaJson.setTarget ?? d.criteriaJson.minConsecutive ?? 1,
          percent: row
            ? 100
            : (prog?.progressPercent ?? 0),
        },
        reward: {
          coins: d.rewardJson.coins ?? 0,
          gems: d.rewardJson.gems ?? 0,
        },
      };
    });

    const earnedCount = badges.filter((b) => b.status === 'earned').length;
    return {
      summary: {
        earned: earnedCount,
        totalCore: BADGE_CORE_TOTAL,
        completionPercent:
          Math.round((earnedCount / BADGE_CORE_TOTAL) * 1000) / 10,
      },
      featuredCodes: featured.map((f) => f.badgeCode),
      visibility: {
        showOnProfile: settings.showOnProfile,
        showProgress: settings.showProgress,
      },
      badges,
    };
  }

  async getUserBadges(viewerId: string, targetUserId: string) {
    const settings = await this.ensureSettings(targetUserId);
    if (!settings.showOnProfile && viewerId !== targetUserId) {
      throw new AppException(
        AuthErrorCode.BADGE_PROFILE_HIDDEN,
        'Badge collection is private',
        HttpStatus.FORBIDDEN,
      );
    }
    const mine = await this.getMyBadges(targetUserId);
    if (viewerId !== targetUserId) {
      return {
        summary: mine.summary,
        featuredCodes: mine.featuredCodes,
        badges: mine.badges
          .filter((b) => b.status === 'earned')
          .map((b) => ({
            ...b,
            progress: settings.showProgress ? b.progress : undefined,
          })),
      };
    }
    return mine;
  }

  async setFeatured(userId: string, codes: string[]) {
    if (codes.length > BADGE_FEATURED_MAX) {
      throw new AppException(
        AuthErrorCode.BADGE_FEATURED_LIMIT,
        `At most ${BADGE_FEATURED_MAX} featured badges`,
      );
    }
    const unique = [...new Set(codes)];
    if (unique.length) {
      const owned = await this.userBadgesRepo.find({
        where: {
          userId,
          badgeId: In(unique),
          status: UserBadgeStatus.Earned,
        },
      });
      if (owned.length !== unique.length) {
        throw new AppException(
          AuthErrorCode.BADGE_NOT_EARNED,
          'Can only feature earned badges',
        );
      }
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(BadgeFeaturedSlot, { userId });
      for (let i = 0; i < unique.length; i++) {
        await manager.save(
          manager.create(BadgeFeaturedSlot, {
            userId,
            slotIndex: i,
            badgeCode: unique[i],
          }),
        );
      }
    });
    return this.getMyBadges(userId);
  }

  async setVisibility(
    userId: string,
    patch: { showOnProfile?: boolean; showProgress?: boolean },
  ) {
    const settings = await this.ensureSettings(userId);
    if (patch.showOnProfile !== undefined) {
      settings.showOnProfile = patch.showOnProfile;
    }
    if (patch.showProgress !== undefined) {
      settings.showProgress = patch.showProgress;
    }
    await this.settingsRepo.save(settings);
    return {
      showOnProfile: settings.showOnProfile,
      showProgress: settings.showProgress,
    };
  }

  /** Outbox / domain hook — best-effort, never throws to caller. */
  async onDomainEvent(event: DomainEvent): Promise<void> {
    try {
      const userId = String(event.payload.userId ?? '');
      if (!userId) return;

      if (event.type === OUTBOX_LESSON_COMPLETED) {
        await this.handleLessonCompleted(userId, event);
      } else if (event.type === OUTBOX_WEEK_SEALED) {
        await this.handleWeekSealed(userId, event);
      } else if (event.type === OUTBOX_STUDY_COMPLETED) {
        await this.bumpCounter(userId, 'study_sessions_qualified', 1, event);
        const partnerId = String(event.payload.partnerId ?? '');
        if (partnerId) {
          await this.addToSet(userId, 'study_partners', partnerId, event);
        }
      } else if (event.type === OUTBOX_BATTLE_COMPLETED) {
        if (event.payload.won === true || event.payload.isWinner === true) {
          await this.bumpCounter(userId, 'battle_wins', 1, event);
        }
      } else if (event.type === OUTBOX_REFERRAL_MILESTONE) {
        const q = Number(event.payload.qualifiedCount ?? event.payload.qualifiedRequired ?? 0);
        await this.setCounter(userId, 'referrals_qualified', q, event);
      } else if (
        event.type === 'roadmap.generated.v1' ||
        event.type === 'weekly_plan.activated.v1' ||
        event.type === 'comeback.completed.v1'
      ) {
        await this.unlockEventOnce(userId, event.type, event);
      }

      await this.evaluateAllForUser(userId, event);
    } catch (err) {
      this.logger.warn(
        `Badge eval failed type=${event.type}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Direct grant used by ranks/wheel/referral cosmetic paths.
   * Idempotent on (userId, badgeId).
   */
  async grantCosmeticInTx(
    manager: EntityManager,
    input: {
      userId: string;
      badgeId: string;
      badgeLabel: string;
      sourceEntityType?: string;
      sourceEntityId?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<boolean> {
    const repo = manager.getRepository(UserBadge);
    const existing = await repo.findOne({
      where: { userId: input.userId, badgeId: input.badgeId },
    });
    if (existing) return false;
    const def = await manager.getRepository(BadgeDefinition).findOne({
      where: { code: input.badgeId },
    });
    await repo.save(
      repo.create({
        userId: input.userId,
        badgeId: input.badgeId,
        badgeLabel: input.badgeLabel,
        badgeDefinitionId: def?.id ?? null,
        badgeVersion: def?.version ?? null,
        status: UserBadgeStatus.Earned,
        earnedAt: new Date(),
        sourceEntityType: input.sourceEntityType ?? null,
        sourceEntityId: input.sourceEntityId ?? null,
        metadataJson: input.metadata ?? null,
      }),
    );
    return true;
  }

  // ── evaluation internals ─────────────────────────────────

  private async handleLessonCompleted(userId: string, event: DomainEvent) {
    const lessons = await this.lessonProgressRepo.count({
      where: { userId, status: LessonProgressStatus.Completed },
    });
    await this.setCounter(userId, 'lessons_completed', lessons, event);

    const lessonType = String(event.payload.lessonType ?? '');
    if (lessonType) {
      await this.addToSet(userId, 'lesson_formats', lessonType, event);
    }

    const score = Number(event.payload.scorePercent ?? 0);
    if (score > 0) {
      await this.bumpCounter(userId, 'quizzes_passed', 1, event);
      if (score >= 100) {
        await this.bumpCounter(userId, 'perfect_quizzes', 1, event);
      }
    }

    const practiceTypes = new Set([
      'coding',
      'dataset',
      'practice',
      'guided_example',
      'debugging',
    ]);
    if (practiceTypes.has(lessonType)) {
      await this.bumpCounter(userId, 'practices_completed', 1, event);
    }

    // Deep learner: any completed lesson counts as meaningful for MVP
    await this.bumpCounter(userId, 'deep_lessons', 1, event);

    if (
      lessonType.includes('challenge') ||
      lessonType === 'mini_project' ||
      lessonType === 'project'
    ) {
      await this.bumpCounter(userId, 'challenges_passed', 1, event);
    }
  }

  private async handleWeekSealed(userId: string, event: DomainEvent) {
    await this.bumpCounter(userId, 'weeks_completed', 1, event);
    const streak = Number(
      event.payload.weekIndex ?? event.payload.streakWeeks ?? 0,
    );
    if (streak > 0) {
      await this.setCounter(userId, 'weekly_streak', streak, event);
    } else {
      await this.bumpCounter(userId, 'weekly_streak', 1, event);
    }
  }

  private async evaluateAllForUser(userId: string, event: DomainEvent) {
    const defs = await this.activeDefs();
    const progressRows = await this.progressRepo.find({ where: { userId } });
    const progressBy = new Map(progressRows.map((p) => [p.badgeCode, p]));

    for (const def of defs) {
      const owned = await this.userBadgesRepo.findOne({
        where: { userId, badgeId: def.code, status: UserBadgeStatus.Earned },
      });
      if (owned) continue;

      const c = def.criteriaJson;
      let current = 0;
      let target = c.target ?? c.setTarget ?? c.minConsecutive ?? 1;
      let eligible = false;

      if (def.criteriaType === BadgeCriteriaType.Counter) {
        current = progressBy.get(def.code)?.currentValue
          ?? this.readCounter(progressBy, def.code, c.counterKey!);
        // Prefer dedicated progress row keyed by badge, else shared counter bag
        const bag = progressBy.get(`__counter:${c.counterKey}`);
        current = bag?.currentValue ?? current;
        target = c.target ?? 1;
        eligible = current >= target;
        await this.upsertProgress(userId, def.code, current, target, event.id ?? null);
      } else if (def.criteriaType === BadgeCriteriaType.DistinctSet) {
        const bag = progressBy.get(`__set:${c.setKey}`);
        const items = (bag?.progressJson?.items as string[] | undefined) ?? [];
        current = items.length;
        target = c.setTarget ?? 1;
        eligible = current >= target;
        await this.upsertProgress(userId, def.code, current, target, event.id ?? null, {
          items,
        });
      } else if (def.criteriaType === BadgeCriteriaType.Consecutive) {
        const bag = progressBy.get(`__counter:${c.consecutiveKey}`);
        current = bag?.currentValue ?? 0;
        target = c.minConsecutive ?? 1;
        eligible = current >= target;
        await this.upsertProgress(userId, def.code, current, target, event.id ?? null);
      } else if (def.criteriaType === BadgeCriteriaType.EventOnce) {
        const bag = progressBy.get(`__event:${c.eventType}`);
        current = bag?.currentValue ?? 0;
        target = 1;
        eligible = current >= 1;
        await this.upsertProgress(userId, def.code, current, target, event.id ?? null);
      } else if (def.criteriaType === BadgeCriteriaType.ReferralMilestone) {
        const bag = progressBy.get('__counter:referrals_qualified');
        current = bag?.currentValue ?? 0;
        target = c.referralQualified ?? 1;
        eligible = current >= target;
        await this.upsertProgress(userId, def.code, current, target, event.id ?? null);
      } else if (def.criteriaType === BadgeCriteriaType.Composite) {
        // Composite gates deferred — progress only
        continue;
      }

      if (eligible) {
        await this.unlockBadge(userId, def, event);
      }
    }
  }

  private readCounter(
    progressBy: Map<string, UserBadgeProgress>,
    _badgeCode: string,
    counterKey: string,
  ) {
    return progressBy.get(`__counter:${counterKey}`)?.currentValue ?? 0;
  }

  private async bumpCounter(
    userId: string,
    key: string,
    delta: number,
    event: DomainEvent,
  ) {
    const code = `__counter:${key}`;
    const row = await this.ensureProgressRow(userId, code, 999999);
    row.currentValue += delta;
    row.progressPercent = Math.min(
      100,
      Math.round((row.currentValue / Math.max(row.targetValue, 1)) * 100),
    );
    row.lastEventId = event.id ?? null;
    await this.progressRepo.save(row);
  }

  private async setCounter(
    userId: string,
    key: string,
    value: number,
    event: DomainEvent,
  ) {
    const code = `__counter:${key}`;
    const row = await this.ensureProgressRow(userId, code, 999999);
    row.currentValue = Math.max(row.currentValue, value);
    row.lastEventId = event.id ?? null;
    await this.progressRepo.save(row);
  }

  private async addToSet(
    userId: string,
    key: string,
    item: string,
    event: DomainEvent,
  ) {
    const code = `__set:${key}`;
    const row = await this.ensureProgressRow(userId, code, 999999);
    const items = new Set(
      ((row.progressJson?.items as string[] | undefined) ?? []),
    );
    items.add(item);
    row.progressJson = { items: [...items] };
    row.currentValue = items.size;
    row.lastEventId = event.id ?? null;
    await this.progressRepo.save(row);
  }

  private async unlockEventOnce(
    userId: string,
    eventType: string,
    event: DomainEvent,
  ) {
    const code = `__event:${eventType}`;
    const row = await this.ensureProgressRow(userId, code, 1);
    row.currentValue = 1;
    row.progressPercent = 100;
    row.lastEventId = event.id ?? null;
    await this.progressRepo.save(row);
  }

  private async ensureProgressRow(
    userId: string,
    badgeCode: string,
    target: number,
  ) {
    let row = await this.progressRepo.findOne({
      where: { userId, badgeCode },
    });
    if (!row) {
      row = this.progressRepo.create({
        userId,
        badgeCode,
        currentValue: 0,
        targetValue: target,
        progressPercent: 0,
        progressJson: null,
      });
    }
    row.targetValue = target;
    return row;
  }

  private async upsertProgress(
    userId: string,
    badgeCode: string,
    current: number,
    target: number,
    lastEventId: string | null,
    progressJson?: Record<string, unknown>,
  ) {
    const row = await this.ensureProgressRow(userId, badgeCode, target);
    row.currentValue = current;
    row.targetValue = target;
    row.progressPercent = Math.min(
      100,
      Math.round((current / Math.max(target, 1)) * 100),
    );
    row.lastEventId = lastEventId;
    if (progressJson) row.progressJson = progressJson;
    await this.progressRepo.save(row);
  }

  private async unlockBadge(
    userId: string,
    def: BadgeDefinition,
    event: DomainEvent,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(UserBadge);
      const existing = await repo.findOne({
        where: { userId, badgeId: def.code },
      });
      if (existing) {
        await manager.save(
          manager.create(BadgeUnlockEvent, {
            userId,
            badgeCode: def.code,
            sourceEventId: event.id ?? null,
            sourceEventType: event.type,
            result: 'already',
            reason: 'already_earned',
            snapshot: null,
          }),
        );
        return;
      }

      let rewardGroup: string | null = null;
      const reward = def.rewardJson;
      if (!reward.skipLedger && ((reward.coins ?? 0) > 0 || (reward.gems ?? 0) > 0)) {
        const grant = await this.ledger.grantReward(manager, {
          userId,
          reasonType: RewardReasonType.Badge,
          reasonId: def.code,
          idempotencyKey: `badge:${userId}:${def.code}`,
          lines: [
            {
              currency: RewardCurrency.Coins,
              amount: reward.coins ?? 0,
              idempotencySuffix: 'coins',
            },
            {
              currency: RewardCurrency.Gems,
              amount: reward.gems ?? 0,
              idempotencySuffix: 'gems',
            },
          ],
          metadata: { badgeCode: def.code, countsForLeague: false },
        });
        rewardGroup = grant.transactionGroupId;
      }

      await repo.save(
        repo.create({
          userId,
          badgeId: def.code,
          badgeLabel: def.name,
          badgeDefinitionId: def.id,
          badgeVersion: def.version,
          status: UserBadgeStatus.Earned,
          earnedAt: new Date(),
          sourceEventId: event.id ?? null,
          sourceEntityType: String(event.payload.sourceEntityType ?? event.type),
          sourceEntityId: (event.payload.lessonId as string) ?? null,
          rewardTransactionGroupId: rewardGroup,
          metadataJson: { eventType: event.type },
        }),
      );

      await manager.save(
        manager.create(BadgeUnlockEvent, {
          userId,
          badgeCode: def.code,
          sourceEventId: event.id ?? null,
          sourceEventType: event.type,
          result: 'unlocked',
          reason: null,
          snapshot: { reward },
        }),
      );

      await this.outbox.enqueue(manager, {
        type: OUTBOX_BADGE_UNLOCKED,
        aggregateId: def.code,
        payload: {
          userId,
          badgeCode: def.code,
          badgeName: def.name,
          rarity: def.rarity,
        },
      });
    });

    await this.notifications?.create({
      userId,
      type: NotificationType.BadgeUnlocked,
      title: 'Badge unlocked',
      body: `You earned ${def.name}.`,
      actionUrl: '/badges',
      payload: { badgeCode: def.code },
      dedupeKey: `badge_unlocked:${userId}:${def.code}`,
      channels: [NotificationChannel.InApp, NotificationChannel.Push],
    });
  }

  private async activeDefs() {
    return this.defsRepo.find({
      where: { status: BadgeDefinitionStatus.Active },
      order: { sortOrder: 'ASC' },
    });
  }

  private async ensureSettings(userId: string) {
    let row = await this.settingsRepo.findOne({ where: { userId } });
    if (!row) {
      row = await this.settingsRepo.save(
        this.settingsRepo.create({
          userId,
          showOnProfile: true,
          showProgress: true,
        }),
      );
    }
    return row;
  }

  private serializeDef(d: BadgeDefinition) {
    return {
      code: d.code,
      name: d.name,
      description: d.description,
      category: d.category,
      rarity: d.rarity,
      iconAssetKey: d.iconAssetKey,
      isHidden: d.isHidden,
      isSeasonal: d.isSeasonal,
      sortOrder: d.sortOrder,
      version: d.version,
    };
  }
}
