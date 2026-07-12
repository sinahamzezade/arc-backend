import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { GamificationService } from '../gamification/gamification.service';
import {
  RewardCurrency,
  RewardReasonType,
} from '../gamification/entities/reward-ledger-entry.entity';
import { UserInventoryItem } from '../gamification/entities/user-inventory-item.entity';
import { Wallet } from '../gamification/entities/wallet.entity';
import { localDayKey } from '../leagues/league-season-bounds';
import { LeaguesService } from '../leagues/leagues.service';
import { UserBadge } from '../badges/entities/user-badge.entity';
import { NotificationType } from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { ProfilesService } from '../profiles/profiles.service';
import { Profile } from '../profiles/entities/profile.entity';
import { SocialPermissionService } from '../social/social-permission.service';
import { RankDefinition } from './entities/rank-definition.entity';
import { RankProgressRequirement } from './entities/rank-progress-requirement.entity';
import { RankUnlockHistory } from './entities/rank-unlock-history.entity';
import { UserRankState } from './entities/user-rank-state.entity';
import { OUTBOX_RANK_UNLOCKED, RANK_SEEDS } from './ranks.constants';
import {
  ensureBaseGates,
  evaluateGates,
  type RankEvalContext,
  type RankRequirementStatus,
} from './ranks.evaluator';

const MEANINGFUL_ACTIONS = new Set([
  'lesson',
  'quest',
  'phase',
  'assessment',
  'challenge',
  'project',
  'weekly_seal',
  'boss_challenge',
  'portfolio_capstone',
  'interview_readiness',
]);

@Injectable()
export class RanksService implements OnModuleInit {
  private readonly logger = new Logger(RanksService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(RankDefinition)
    private readonly definitionsRepo: Repository<RankDefinition>,
    @InjectRepository(UserRankState)
    private readonly statesRepo: Repository<UserRankState>,
    @InjectRepository(RankProgressRequirement)
    private readonly requirementsRepo: Repository<RankProgressRequirement>,
    @InjectRepository(RankUnlockHistory)
    private readonly historyRepo: Repository<RankUnlockHistory>,
    @Inject(forwardRef(() => GamificationService))
    private readonly gamification: GamificationService,
    private readonly profiles: ProfilesService,
    private readonly notifications: NotificationsService,
    private readonly socialPermissions: SocialPermissionService,
    @Optional()
    @Inject(forwardRef(() => LeaguesService))
    private readonly leagues?: LeaguesService,
  ) {}

  async onModuleInit() {
    await this.ensureSeedDefinitions();
  }

  async ensureSeedDefinitions() {
    for (const seed of RANK_SEEDS) {
      const existing = await this.definitionsRepo.findOne({
        where: { level: seed.level },
      });
      if (existing) {
        existing.slug = seed.slug;
        existing.title = seed.title;
        existing.xpThreshold = seed.xpThreshold;
        existing.minimumActiveDays = seed.minimumActiveDays;
        existing.gateRules = seed.gateRules;
        existing.rewardConfig = seed.rewardConfig;
        existing.iconAssetKey = seed.iconAssetKey;
        existing.displayOrder = seed.level;
        existing.isActive = true;
        await this.definitionsRepo.save(existing);
        continue;
      }
      await this.definitionsRepo.save(
        this.definitionsRepo.create({
          level: seed.level,
          slug: seed.slug,
          title: seed.title,
          xpThreshold: seed.xpThreshold,
          minimumActiveDays: seed.minimumActiveDays,
          gateRules: seed.gateRules,
          rewardConfig: seed.rewardConfig,
          iconAssetKey: seed.iconAssetKey,
          displayOrder: seed.level,
          isActive: true,
          version: 1,
        }),
      );
    }
  }

  async listDefinitions() {
    const rows = await this.definitionsRepo.find({
      where: { isActive: true },
      order: { displayOrder: 'ASC' },
    });
    return rows.map((r) => this.toDefinitionDto(r));
  }

  async getMe(userId: string) {
    const state = await this.ensureState(userId);
    const wallet = await this.gamification.getWallet(userId);
    const defs = await this.definitionsRepo.find({
      where: { isActive: true },
      order: { displayOrder: 'ASC' },
    });
    const current =
      defs.find((d) => d.level === state.currentRankLevel) ?? defs[0];
    const next =
      defs.find((d) => d.level === state.currentRankLevel + 1) ?? null;

    const ctx = this.buildContext(state, wallet.lifetimeXp);
    let requirements: RankRequirementStatus[] = [];
    if (next) {
      const gates = ensureBaseGates(
        next.gateRules,
        next.xpThreshold,
        next.minimumActiveDays,
      );
      requirements = evaluateGates(gates, ctx).requirements;
      await this.persistRequirements(userId, next.level, requirements);
    }

    const xpInto =
      next != null
        ? Math.max(0, wallet.lifetimeXp - (current?.xpThreshold ?? 0))
        : wallet.lifetimeXp;
    const xpFor =
      next != null
        ? Math.max(1, next.xpThreshold - (current?.xpThreshold ?? 0))
        : 1;

    return {
      current: {
        level: current?.level ?? 1,
        slug: current?.slug ?? 'curious-egg',
        title: current?.title ?? 'Curious Egg',
        lifetimeXp: wallet.lifetimeXp,
        activeDays: state.activeDays,
        iconAssetKey: current?.iconAssetKey ?? null,
      },
      next: next
        ? {
            level: next.level,
            slug: next.slug,
            title: next.title,
            xp: {
              current: wallet.lifetimeXp,
              required: next.xpThreshold,
              intoLevel: Math.min(xpInto, xpFor),
              forLevel: xpFor,
            },
            requirements,
          }
        : null,
      evaluationHeld: state.evaluationHeld,
      holdReason: state.holdReason,
      hideFromProfile: state.hideFromProfile,
    };
  }

  async getLadder(userId: string) {
    const me = await this.getMe(userId);
    const defs = await this.definitionsRepo.find({
      where: { isActive: true },
      order: { displayOrder: 'ASC' },
    });
    const currentLevel = me.current.level;
    return {
      currentLevel,
      tiers: defs.map((d) => ({
        level: d.level,
        slug: d.slug,
        title: d.title,
        xpThreshold: d.xpThreshold,
        minimumActiveDays: d.minimumActiveDays,
        iconAssetKey: d.iconAssetKey,
        status:
          d.level < currentLevel
            ? ('earned' as const)
            : d.level === currentLevel
              ? ('current' as const)
              : ('locked' as const),
        blurb:
          d.level < currentLevel
            ? 'Cleared. Keep climbing.'
            : d.level === currentLevel
              ? 'You’re here.'
              : d.level === currentLevel + 1
                ? 'Next unlock — XP + milestones.'
                : 'Locked until XP + milestones catch up.',
      })),
      me,
    };
  }

  async getUserRank(viewerId: string, targetUserId: string) {
    if (await this.socialPermissions.isBlockedEither(viewerId, targetUserId)) {
      return { userId: targetUserId, hidden: true as const, rank: null };
    }
    const state = await this.ensureState(targetUserId);
    if (state.hideFromProfile && viewerId !== targetUserId) {
      return { userId: targetUserId, hidden: true as const, rank: null };
    }
    const def = await this.definitionsRepo.findOne({
      where: { level: state.currentRankLevel, isActive: true },
    });
    return {
      userId: targetUserId,
      hidden: false as const,
      rank: {
        level: state.currentRankLevel,
        slug: state.currentRankSlug,
        title: def?.title ?? state.currentRankSlug,
        iconAssetKey: def?.iconAssetKey ?? null,
      },
    };
  }

  async setPrivacy(userId: string, hideFromProfile: boolean) {
    const state = await this.ensureState(userId);
    state.hideFromProfile = hideFromProfile;
    await this.statesRepo.save(state);
    return { hideFromProfile };
  }

  /**
   * Record meaningful learning action → active day + optional counter bumps.
   * Then evaluate unlocks (capped celebration per call).
   */
  async recordActivity(
    userId: string,
    input: {
      actionType: string;
      actionId?: string | null;
      counterDeltas?: Record<string, number>;
      reason?: string;
      occurredAt?: Date;
    },
  ) {
    return this.dataSource.transaction(async (manager) => {
      const state = await this.ensureStateInTx(manager, userId);
      if (state.evaluationHeld) {
        return {
          held: true as const,
          unlocked: [] as Awaited<
            ReturnType<RanksService['evaluateInTx']>
          >['unlocked'],
        };
      }

      const profile = await this.profiles.findByUserId(userId);
      const tz = profile?.timezone || 'UTC';
      const occurredAt = input.occurredAt ?? new Date();

      if (MEANINGFUL_ACTIONS.has(input.actionType)) {
        const day = localDayKey(occurredAt, tz);
        const days = new Set(state.activeDayKeys ?? []);
        if (!days.has(day)) {
          days.add(day);
          state.activeDayKeys = [...days];
          state.activeDays = days.size;
        }
      }

      if (input.counterDeltas) {
        const counters = { ...(state.progressCounters ?? {}) };
        for (const [k, v] of Object.entries(input.counterDeltas)) {
          if (!Number.isFinite(v) || v === 0) continue;
          counters[k] = Math.max(0, (counters[k] ?? 0) + v);
        }
        state.progressCounters = counters;
      }

      // Map common action → counter when not explicit
      if (
        !input.counterDeltas ||
        Object.keys(input.counterDeltas).length === 0
      ) {
        const auto = this.autoCounterForAction(input.actionType);
        if (auto) {
          const counters = { ...(state.progressCounters ?? {}) };
          counters[auto] = (counters[auto] ?? 0) + 1;
          state.progressCounters = counters;
        }
      }

      state.nextEvaluationReason = input.reason ?? input.actionType;
      await manager.getRepository(UserRankState).save(state);

      return this.evaluateInTx(manager, userId, {
        reason: input.reason ?? input.actionType,
        celebrateCap: 1,
      });
    });
  }

  /** Public evaluate entry (idempotent). */
  async evaluate(userId: string, reason = 'manual') {
    return this.dataSource.transaction((manager) =>
      this.evaluateInTx(manager, userId, { reason, celebrateCap: 1 }),
    );
  }

  async evaluateInTx(
    manager: EntityManager,
    userId: string,
    opts: { reason: string; celebrateCap: number },
  ) {
    const state = await this.ensureStateInTx(manager, userId);
    if (state.evaluationHeld) {
      throw new AppException(
        AuthErrorCode.RANK_EVALUATION_HELD,
        state.holdReason ?? 'Rank evaluation on hold',
        HttpStatus.FORBIDDEN,
      );
    }

    const wallet = await manager.getRepository(Wallet).findOne({
      where: { userId },
    });
    const lifetimeXp = wallet?.lifetimeXp ?? 0;
    state.evaluatedXp = lifetimeXp;
    state.evaluatedAt = new Date();
    state.nextEvaluationReason = opts.reason;

    const defs = await manager.getRepository(RankDefinition).find({
      where: { isActive: true },
      order: { displayOrder: 'ASC' },
    });
    if (!defs.length) {
      throw new AppException(
        AuthErrorCode.RANK_DEFINITION_MISSING,
        'Rank definitions missing',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const unlocked: Array<{
      level: number;
      slug: string;
      title: string;
      celebrated: boolean;
    }> = [];

    let celebrated = 0;
    let cursor = state.currentRankLevel;

    while (true) {
      const next = defs.find((d) => d.level === cursor + 1);
      if (!next) break;

      const ctx = this.buildContext(state, lifetimeXp);
      const gates = ensureBaseGates(
        next.gateRules,
        next.xpThreshold,
        next.minimumActiveDays,
      );
      const { allComplete, requirements } = evaluateGates(gates, ctx);
      await this.persistRequirementsInTx(
        manager,
        userId,
        next.level,
        requirements,
      );

      if (!allComplete) {
        await this.maybeNotifyRankClose(userId, next, requirements, lifetimeXp);
        break;
      }

      const historyRepo = manager.getRepository(RankUnlockHistory);
      const existing = await historyRepo.findOne({
        where: { userId, newRankLevel: next.level },
      });
      if (existing) {
        // Already unlocked — heal state if drifted
        state.currentRankLevel = Math.max(state.currentRankLevel, next.level);
        state.currentRankSlug = next.slug;
        state.highestRankLevel = Math.max(state.highestRankLevel, next.level);
        cursor = next.level;
        continue;
      }

      const oldLevel = state.currentRankLevel;
      const oldSlug = state.currentRankSlug;
      const shouldCelebrate = celebrated < opts.celebrateCap;

      const rewardTxId = await this.grantRankReward(manager, userId, next);

      await historyRepo.save(
        historyRepo.create({
          userId,
          oldRankLevel: oldLevel,
          oldRankSlug: oldSlug,
          newRankLevel: next.level,
          newRankSlug: next.slug,
          xpSnapshot: lifetimeXp,
          gateSnapshot: { requirements },
          rewardTransactionId: rewardTxId,
        }),
      );

      state.currentRankLevel = next.level;
      state.currentRankSlug = next.slug;
      state.highestRankLevel = Math.max(state.highestRankLevel, next.level);

      await this.mirrorProfileRank(manager, userId, next.title);
      if (this.leagues) {
        await this.leagues.updateRankGateInputs(userId, {
          rankLevel: next.level,
        });
      }

      unlocked.push({
        level: next.level,
        slug: next.slug,
        title: next.title,
        celebrated: shouldCelebrate,
      });

      if (shouldCelebrate) {
        celebrated += 1;
        await this.notifications.create({
          userId,
          type: NotificationType.RankUnlocked,
          title: 'Rank unlocked',
          body: `Rank unlocked: ${next.title}.`,
          actionUrl: '/rank',
          dedupeKey: `rank-unlocked:${userId}:${next.level}`,
          payload: {
            level: next.level,
            slug: next.slug,
            title: next.title,
          },
          sourceEventId: OUTBOX_RANK_UNLOCKED,
        });
      }

      cursor = next.level;
      if (celebrated >= opts.celebrateCap) {
        // Cap visible celebration; continue unlocking silently if more pass
        // Doc: "cap to one visible rank celebration per transaction"
        // Still unlock further ranks without extra notifs if they also pass.
        continue;
      }
    }

    await manager.getRepository(UserRankState).save(state);
    return { unlocked, currentLevel: state.currentRankLevel };
  }

  /** Outbox consumer hook from gamification. */
  async onDomainEvent(event: {
    type: string;
    payload: Record<string, unknown>;
  }) {
    const userId = String(event.payload.userId ?? '');
    if (!userId) return;

    try {
      if (event.type === 'lesson.completed.v1') {
        await this.recordActivity(userId, {
          actionType: 'lesson',
          actionId: String(
            event.payload.lessonId ?? event.payload.reasonId ?? '',
          ),
          counterDeltas: { lessons_completed: 1 },
          reason: 'lesson.completed',
        });
        return;
      }
      if (event.type === 'week.sealed.v1') {
        await this.recordActivity(userId, {
          actionType: 'weekly_seal',
          actionId: String(event.payload.weeklyPlanId ?? ''),
          counterDeltas: { weekly_seals: 1 },
          reason: 'week.sealed',
        });
        return;
      }
      if (
        event.type === 'reward.granted.v1' ||
        event.type === 'gamification.reward_granted'
      ) {
        await this.evaluate(userId, 'reward.granted');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Rank event ${event.type} failed: ${message}`);
    }
  }

  private autoCounterForAction(actionType: string): string | null {
    switch (actionType) {
      case 'lesson':
        return 'lessons_completed';
      case 'quest':
        return 'quests_completed';
      case 'phase':
        return 'phases_completed';
      case 'assessment':
        return 'assessments_passed';
      case 'challenge':
        return 'challenges_passed';
      case 'boss_challenge':
        return 'boss_challenges_passed';
      case 'project':
        return 'projects_completed';
      case 'weekly_seal':
        return 'weekly_seals';
      case 'portfolio_capstone':
        return 'portfolio_capstone_completed';
      case 'interview_readiness':
        return 'interview_readiness';
      default:
        return null;
    }
  }

  private buildContext(
    state: UserRankState,
    lifetimeXp: number,
  ): RankEvalContext {
    return {
      lifetimeXp,
      activeDays: state.activeDays,
      counters: state.progressCounters ?? {},
    };
  }

  private async grantRankReward(
    manager: EntityManager,
    userId: string,
    def: RankDefinition,
  ): Promise<string | null> {
    const cfg = def.rewardConfig ?? {};
    const lines: Array<{
      currency: RewardCurrency;
      amount: number;
      idempotencySuffix: string;
    }> = [];
    if (cfg.coins && cfg.coins > 0) {
      lines.push({
        currency: RewardCurrency.Coins,
        amount: cfg.coins,
        idempotencySuffix: 'coins',
      });
    }
    if (cfg.gems && cfg.gems > 0) {
      lines.push({
        currency: RewardCurrency.Gems,
        amount: cfg.gems,
        idempotencySuffix: 'gems',
      });
    }

    let txId: string | null = null;
    if (lines.length) {
      const grant = await this.gamification.grantInTx(manager, {
        userId,
        reasonType: RewardReasonType.Rank,
        reasonId: `rank:${def.level}`,
        idempotencyKey: `rank-unlock:${userId}:${def.level}`,
        metadata: { countsForLeague: false, rankLevel: def.level },
        lines,
      });
      txId = grant.transactionGroupId;
    }

    if (cfg.badgeId && cfg.badgeLabel) {
      const badgeRepo = manager.getRepository(UserBadge);
      const existing = await badgeRepo.findOne({
        where: { userId, badgeId: cfg.badgeId },
      });
      if (!existing) {
        await badgeRepo.save(
          badgeRepo.create({
            userId,
            badgeId: cfg.badgeId,
            badgeLabel: cfg.badgeLabel,
          }),
        );
      }
    }

    if (cfg.frameSku) {
      const invRepo = manager.getRepository(UserInventoryItem);
      const existing = await invRepo.findOne({
        where: { userId, sku: cfg.frameSku },
      });
      if (!existing) {
        await invRepo.save(
          invRepo.create({
            userId,
            sku: cfg.frameSku,
            quantity: 1,
            equipped: false,
            acquiredFrom: 'rank',
            payload: {
              slot: 'frame',
              label: cfg.frameLabel ?? cfg.frameSku,
              rankLevel: def.level,
            },
          }),
        );
      }
    }

    return txId;
  }

  private async mirrorProfileRank(
    manager: EntityManager,
    userId: string,
    title: string,
  ) {
    const profileRepo = manager.getRepository(Profile);
    const profile = await profileRepo.findOne({ where: { userId } });
    if (!profile) return;
    profile.currentRank = title;
    await profileRepo.save(profile);
  }

  private async maybeNotifyRankClose(
    userId: string,
    next: RankDefinition,
    requirements: RankRequirementStatus[],
    lifetimeXp: number,
  ) {
    const incomplete = requirements.filter((r) => !r.complete);
    if (incomplete.length !== 1) return;
    const only = incomplete[0];
    if (only.key === 'lifetime_xp') return;

    const xpReady =
      lifetimeXp >= next.xpThreshold ||
      requirements.find((r) => r.key === 'lifetime_xp')?.complete;

    const state = await this.statesRepo.findOne({ where: { userId } });
    if (!state) return;
    if (state.rankCloseNotifiedLevel === next.level) return;

    state.rankCloseNotifiedLevel = next.level;
    await this.statesRepo.save(state);

    const body = xpReady
      ? `XP is ready. Finish the milestone to climb to ${next.title}.`
      : `One more step stands between you and ${next.title}.`;

    await this.notifications.create({
      userId,
      type: NotificationType.RankClose,
      title: 'Rank almost unlocked',
      body,
      actionUrl: '/rank',
      dedupeKey: `rank-close:${userId}:${next.level}`,
      payload: {
        level: next.level,
        missing: only.key,
        title: next.title,
      },
    });

    // Also emit gate-completed for the last remaining? only when a gate flips — thin for now
  }

  private async persistRequirements(
    userId: string,
    rankLevel: number,
    requirements: RankRequirementStatus[],
  ) {
    await this.dataSource.transaction((manager) =>
      this.persistRequirementsInTx(manager, userId, rankLevel, requirements),
    );
  }

  private async persistRequirementsInTx(
    manager: EntityManager,
    userId: string,
    rankLevel: number,
    requirements: RankRequirementStatus[],
  ) {
    const repo = manager.getRepository(RankProgressRequirement);
    const now = new Date();
    for (const req of requirements) {
      let row = await repo.findOne({
        where: {
          userId,
          rankLevel,
          requirementKey: req.key,
        },
      });
      if (!row) {
        row = repo.create({
          userId,
          rankLevel,
          requirementKey: req.key,
          requiredValue: req.required,
          currentValue: req.current,
          complete: req.complete,
          sourceIds: [],
          evaluatedAt: now,
        });
      } else {
        row.requiredValue = req.required;
        row.currentValue = req.current;
        row.complete = req.complete;
        row.evaluatedAt = now;
      }
      await repo.save(row);
    }
  }

  async ensureState(userId: string) {
    return this.dataSource.transaction((manager) =>
      this.ensureStateInTx(manager, userId),
    );
  }

  private async ensureStateInTx(manager: EntityManager, userId: string) {
    const repo = manager.getRepository(UserRankState);
    let state = await repo.findOne({
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (state) return state;

    const egg = await manager.getRepository(RankDefinition).findOne({
      where: { level: 1 },
    });
    state = repo.create({
      userId,
      currentRankLevel: 1,
      currentRankSlug: egg?.slug ?? 'curious-egg',
      highestRankLevel: 1,
      evaluatedXp: 0,
      activeDayKeys: [],
      activeDays: 0,
      progressCounters: {},
      evaluationHeld: false,
      hideFromProfile: false,
    });
    state = await repo.save(state);

    const profile = await this.profiles.findByUserId(userId);
    if (profile && !profile.currentRank) {
      profile.currentRank = egg?.title ?? 'Curious Egg';
      await manager.save(profile);
    }
    return state;
  }

  private toDefinitionDto(r: RankDefinition) {
    return {
      level: r.level,
      slug: r.slug,
      title: r.title,
      xpThreshold: r.xpThreshold,
      minimumActiveDays: r.minimumActiveDays,
      gateRules: r.gateRules,
      rewardConfig: r.rewardConfig,
      iconAssetKey: r.iconAssetKey,
      version: r.version,
    };
  }
}
