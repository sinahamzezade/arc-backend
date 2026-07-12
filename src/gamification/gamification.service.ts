import { Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { LeaguesService } from '../leagues/leagues.service';
import { LeagueScoreSourceType } from '../leagues/entities/league.enums';
import { NotificationsService } from '../notifications/notifications.service';
import { RanksService } from '../ranks/ranks.service';
import { ReferralsService } from '../referrals/referrals.service';
import {
  OutboxEvent,
  OutboxEventStatus,
} from './entities/outbox-event.entity';
import { Wallet } from './entities/wallet.entity';
import {
  OUTBOX_GAMIFICATION_REWARD,
  OUTBOX_LESSON_COMPLETED,
  OUTBOX_REWARD_GRANTED,
  OUTBOX_WEEK_SEALED,
  REWARD_RULE_VERSION,
  SEAL_REWARD_RULE_KEY,
} from './reward-constants';
import {
  GrantRewardInput,
  GrantRewardResult,
  RewardLedgerService,
} from './reward-ledger.service';
import { OutboxService } from './outbox.service';
import {
  RewardCurrency,
  RewardReasonType,
} from './entities/reward-ledger-entry.entity';
import { Profile } from '../profiles/entities/profile.entity';
import { StreakService } from './streak.service';

@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);

  constructor(
    private readonly ledger: RewardLedgerService,
    private readonly outbox: OutboxService,
    private readonly dataSource: DataSource,
    @InjectRepository(Wallet)
    private readonly walletsRepo: Repository<Wallet>,
    @InjectRepository(OutboxEvent)
    private readonly outboxRepo: Repository<OutboxEvent>,
    @Optional()
    private readonly streaks?: StreakService,
    @Optional()
    @Inject(forwardRef(() => LeaguesService))
    private readonly leagues?: LeaguesService,
    @Optional()
    @Inject(forwardRef(() => NotificationsService))
    private readonly notifications?: NotificationsService,
    @Optional()
    @Inject(forwardRef(() => RanksService))
    private readonly ranks?: RanksService,
    @Optional()
    @Inject(forwardRef(() => ReferralsService))
    private readonly referrals?: ReferralsService,
  ) {
    void this.walletsRepo;
  }

  get rewardRuleVersion() {
    return REWARD_RULE_VERSION;
  }

  async getWallet(userId: string) {
    return this.dataSource.transaction((manager) =>
      this.ledger.ensureWallet(manager, userId),
    );
  }

  async grantInTx(
    manager: EntityManager,
    input: GrantRewardInput,
  ): Promise<GrantRewardResult> {
    return this.ledger.grantReward(manager, input);
  }

  async ensureWalletInTx(manager: EntityManager, userId: string) {
    return this.ledger.ensureWallet(manager, userId);
  }

  async enqueueRewardGranted(
    manager: EntityManager,
    input: {
      userId: string;
      transactionGroupId: string;
      reasonType: RewardReasonType;
      reasonId: string;
      qualifiedLeagueXp: number;
      lifetimeXp: number;
      gems: number;
      coins: number;
      leagueLedgerEntryId?: string | null;
    },
  ) {
    await this.outbox.enqueue(manager, {
      type: OUTBOX_REWARD_GRANTED,
      aggregateId: input.transactionGroupId,
      payload: {
        userId: input.userId,
        transactionGroupId: input.transactionGroupId,
        reasonType: input.reasonType,
        reasonId: input.reasonId,
        qualifiedLeagueXp: input.qualifiedLeagueXp,
        lifetimeXp: input.lifetimeXp,
        gems: input.gems,
        coins: input.coins,
        leagueLedgerEntryId: input.leagueLedgerEntryId ?? null,
        rewardRuleVersion: REWARD_RULE_VERSION,
      },
    });

    await this.outbox.enqueue(manager, {
      type: OUTBOX_GAMIFICATION_REWARD,
      aggregateId: input.transactionGroupId,
      payload: {
        userId: input.userId,
        transactionGroupId: input.transactionGroupId,
        qualifiedLeagueXp: input.qualifiedLeagueXp,
        leagueLedgerEntryId: input.leagueLedgerEntryId ?? null,
        reasonId: input.reasonId,
        reasonType: input.reasonType,
      },
    });
  }

  async enqueueLessonCompleted(
    manager: EntityManager,
    payload: Record<string, unknown>,
  ) {
    await this.outbox.enqueue(manager, {
      type: OUTBOX_LESSON_COMPLETED,
      aggregateId: (payload.lessonId as string) ?? null,
      payload,
    });
  }

  /**
   * Seal-week reward grant through ledger + streak bump.
   * Idempotent via ledger key `week-seal:{planId}`.
   */
  async sealWeek(
    manager: EntityManager,
    input: {
      userId: string;
      planId: string;
      weekStart: string;
      xp: number;
      gems: number;
      weekIndex: number;
    },
  ): Promise<GrantRewardResult> {
    const grant = await this.ledger.grantReward(manager, {
      userId: input.userId,
      reasonType: RewardReasonType.WeeklySeal,
      reasonId: input.planId,
      idempotencyKey: `week-seal:${input.planId}`,
      metadata: {
        weekStart: input.weekStart,
        weekIndex: input.weekIndex,
        sealRewardRuleKey: SEAL_REWARD_RULE_KEY,
      },
      lines: [
        {
          currency: RewardCurrency.LifetimeXp,
          amount: input.xp,
          idempotencySuffix: 'xp',
        },
        {
          currency: RewardCurrency.Gems,
          amount: input.gems,
          idempotencySuffix: 'gems',
        },
      ],
    });

    if (!grant.alreadyGranted) {
      const profile = await manager.getRepository(Profile).findOne({
        where: { userId: input.userId },
      });
      if (profile) {
        profile.weeklyStreak += 1;
        await manager.getRepository(Profile).save(profile);
      }

      await this.streaks?.bumpWeeklyInTx(manager, input.userId);

      await this.enqueueRewardGranted(manager, {
        userId: input.userId,
        transactionGroupId: grant.transactionGroupId,
        reasonType: RewardReasonType.WeeklySeal,
        reasonId: input.planId,
        qualifiedLeagueXp: 0,
        lifetimeXp: input.xp,
        gems: input.gems,
        coins: 0,
      });

      await this.outbox.enqueue(manager, {
        type: OUTBOX_WEEK_SEALED,
        aggregateId: input.planId,
        payload: {
          userId: input.userId,
          weeklyPlanId: input.planId,
          weekStart: input.weekStart,
          weekIndex: input.weekIndex,
          rewardTransactionGroupId: grant.transactionGroupId,
          xp: input.xp,
          gems: input.gems,
          sealRewardRuleKey: SEAL_REWARD_RULE_KEY,
        },
      });
    }

    return grant;
  }

  /** Best-effort consumer after commit — never rolls back lesson. */
  async processPendingOutbox(limit = 20): Promise<void> {
    const pending = await this.outboxRepo.find({
      where: { status: OutboxEventStatus.Pending },
      order: { createdAt: 'ASC' },
      take: limit,
    });

    for (const event of pending) {
      try {
        if (
          event.type === OUTBOX_GAMIFICATION_REWARD ||
          event.type === OUTBOX_REWARD_GRANTED
        ) {
          const qualified = Number(event.payload.qualifiedLeagueXp ?? 0);
          const userId = String(event.payload.userId ?? '');
          const entryId = String(
            event.payload.leagueLedgerEntryId ??
              event.payload.transactionGroupId ??
              event.id,
          );
          if (qualified > 0 && userId && this.leagues) {
            await this.leagues.ingestQualifiedXp({
              userId,
              ledgerEntryId: entryId,
              xpDelta: qualified,
              sourceType: LeagueScoreSourceType.Lesson,
              sourceId: String(event.payload.reasonId ?? null),
              occurredAt: event.createdAt,
              isProofWeighted: true,
            });
          }
        }
        if (
          event.type === OUTBOX_LESSON_COMPLETED ||
          event.type === OUTBOX_REWARD_GRANTED ||
          event.type === OUTBOX_GAMIFICATION_REWARD ||
          event.type === OUTBOX_WEEK_SEALED
        ) {
          await this.notifications?.handleDomainOutbox({
            id: event.id,
            type: event.type,
            payload: event.payload,
          });
          await this.ranks?.onDomainEvent({
            type: event.type,
            payload: event.payload as Record<string, unknown>,
          });
          if (
            event.type === OUTBOX_LESSON_COMPLETED ||
            event.type === OUTBOX_REWARD_GRANTED
          ) {
            const uid = String(event.payload.userId ?? '');
            if (uid) {
              await this.referrals?.evaluateInvitee(uid);
            }
          }
        }

        await this.outboxRepo.update(event.id, {
          status: OutboxEventStatus.Published,
          publishedAt: new Date(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Outbox ${event.id} failed: ${message}`);
        await this.outboxRepo.update(event.id, {
          status: OutboxEventStatus.Failed,
          attempts: event.attempts + 1,
          lastError: message.slice(0, 2000),
        });
      }
    }
  }

  buildLessonGrantLines(reward: {
    xp: number;
    gems: number;
    coins: number;
    qualifiedLeagueXp: number;
  }) {
    return [
      {
        currency: RewardCurrency.LifetimeXp,
        amount: reward.xp,
        idempotencySuffix: 'xp',
      },
      {
        currency: RewardCurrency.LeagueXp,
        amount: reward.qualifiedLeagueXp,
        idempotencySuffix: 'league',
      },
      {
        currency: RewardCurrency.Gems,
        amount: reward.gems,
        idempotencySuffix: 'gems',
      },
      {
        currency: RewardCurrency.Coins,
        amount: reward.coins,
        idempotencySuffix: 'coins',
      },
    ];
  }
}
