import { Injectable, Logger } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { ProfilesService } from '../profiles/profiles.service';
import { UserInventoryItem } from '../gamification/entities/user-inventory-item.entity';
import { LeagueCohort } from './entities/league-cohort.entity';
import { LeagueFinalResult } from './entities/league-final-result.entity';
import { LeagueMembership } from './entities/league-membership.entity';
import { LeagueSeason } from './entities/league-season.entity';
import { UserLeagueState } from './entities/user-league-state.entity';
import {
  LeagueCohortStatus,
  LeaguePromotionResult,
  LeagueSeasonStatus,
  LeagueTier,
} from './entities/league.enums';
import { applyPromotionResults } from './league-promotion';
import { LeagueLiveScoresService } from './league-live-scores.service';
import { LeagueSeasonService } from './league-season.service';
import { rankByTieBreak, tieBreakSnapshot } from './league-tiebreak';
import { MASTER_TOP3_SKU, SEASON_REWARDS } from './leagues.constants';

@Injectable()
export class LeagueFinalizeService {
  private readonly logger = new Logger(LeagueFinalizeService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly seasonService: LeagueSeasonService,
    private readonly liveScores: LeagueLiveScoresService,
    private readonly notifications: NotificationsService,
    private readonly profiles: ProfilesService,
  ) {}

  /**
   * Idempotent season finalization with advisory lock.
   */
  async finalizeSeason(seasonId: string): Promise<{ cohorts: number; results: number }> {
    return this.dataSource.transaction(async (manager) => {
      // PostgreSQL advisory lock keyed by season uuid hash
      const lockKey = this.advisoryKey(seasonId);
      await manager.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

      const season = await manager.findOne(LeagueSeason, {
        where: { id: seasonId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!season) return { cohorts: 0, results: 0 };
      if (season.status === LeagueSeasonStatus.Finalized) {
        const existing = await manager.count(LeagueFinalResult, {
          where: { seasonId },
        });
        return { cohorts: 0, results: existing };
      }

      season.status = LeagueSeasonStatus.Finalizing;
      await manager.save(season);

      const cohorts = await manager.find(LeagueCohort, {
        where: { seasonId },
      });

      let resultCount = 0;

      for (const cohort of cohorts) {
        if (cohort.status === LeagueCohortStatus.Finalized) continue;

        const memberships = await manager.find(LeagueMembership, {
          where: { cohortId: cohort.id },
        });

        // Reconcile live cache from PG
        await this.liveScores.reconcile(
          cohort.id,
          memberships.map((m) => ({
            userId: m.userId,
            qualifiedXp: m.qualifiedXp,
          })),
        );

        const ranked = rankByTieBreak(memberships);
        for (const row of ranked) {
          await manager.update(LeagueMembership, row.id, {
            position: row.position,
          });
        }

        const states = await manager.find(UserLeagueState, {
          where: { userId: In(ranked.map((r) => r.userId)) },
        });
        const stateByUser = new Map(states.map((s) => [s.userId, s]));

        const promotionInput = ranked.map((m) => {
          const state = stateByUser.get(m.userId);
          return {
            userId: m.userId,
            position: m.position,
            qualifiedXp: m.qualifiedXp,
            placement: {
              tier: cohort.tier,
              division: cohort.division,
            },
            rankLevel: state?.rankLevel ?? 1,
            weeklySeals: state?.weeklySeals ?? 0,
            isBronzeFloor: true,
          };
        });

        const outcomes = applyPromotionResults(promotionInput);
        const outcomeByUser = new Map(outcomes.map((o) => [o.userId, o]));

        for (const m of ranked) {
          const outcome = outcomeByUser.get(m.userId)!;
          const already = await manager.findOne(LeagueFinalResult, {
            where: { seasonId, userId: m.userId },
          });
          if (already) {
            resultCount += 1;
            continue;
          }

          const reward = this.rewardFor(
            outcome.position,
            outcome.result,
            cohort.tier,
          );
          if (reward.coins > 0 || reward.gems > 0) {
            await this.profiles.applyRewards(m.userId, {
              coins: reward.coins,
              gems: reward.gems,
            });
          }

          if (
            cohort.tier === LeagueTier.Master &&
            outcome.position <= 3
          ) {
            await this.grantMasterCosmetic(manager, m.userId);
            reward.cosmeticSku = MASTER_TOP3_SKU;
          }

          const result = manager.create(LeagueFinalResult, {
            seasonId,
            cohortId: cohort.id,
            userId: m.userId,
            membershipId: m.id,
            finalPosition: outcome.position,
            finalXp: m.qualifiedXp,
            tieBreakSnapshot: tieBreakSnapshot(m),
            oldTier: outcome.oldPlacement.tier,
            oldDivision: outcome.oldPlacement.division,
            newTier: outcome.newPlacement.tier,
            newDivision: outcome.newPlacement.division,
            promotionResult: outcome.result,
            rewardTransactionId: null,
            rewardSnapshot: reward,
            notificationStatus: 'pending',
          });
          await manager.save(result);
          resultCount += 1;

          await manager.update(LeagueMembership, m.id, {
            promotionResult: outcome.result,
            position: outcome.position,
          });

          const state = stateByUser.get(m.userId);
          if (state) {
            state.tier = outcome.newPlacement.tier;
            state.division = outcome.newPlacement.division;
            state.recentQualifiedXp = m.qualifiedXp;
            if (m.qualifiedXp <= 0) {
              state.emptySeasons += 1;
              if (outcome.result === LeaguePromotionResult.Inactive) {
                state.isInactive = true;
              }
            } else {
              state.emptySeasons = 0;
              state.isInactive = false;
            }
            state.currentMembershipId = null;
            await manager.save(state);
          }

          await this.notifyResult(m.userId, outcome, reward);
          result.notificationStatus = 'sent';
          await manager.save(result);
        }

        cohort.status = LeagueCohortStatus.Finalized;
        await manager.save(cohort);
        await this.liveScores.clearCohort(cohort.id);
      }

      season.status = LeagueSeasonStatus.Finalized;
      await manager.save(season);

      this.logger.log(
        `league_finalized season=${seasonId} results=${resultCount}`,
      );

      return { cohorts: cohorts.length, results: resultCount };
    });
  }

  private rewardFor(
    position: number,
    result: LeaguePromotionResult,
    _tier: string,
  ): { coins: number; gems: number; cosmeticSku?: string } {
    if (position === 1) return { ...SEASON_REWARDS.place1 };
    if (position === 2) return { ...SEASON_REWARDS.place2 };
    if (position === 3) return { ...SEASON_REWARDS.place3 };
    if (result === LeaguePromotionResult.Promoted) {
      return { ...SEASON_REWARDS.promoted };
    }
    if (result === LeaguePromotionResult.Remained) {
      return { ...SEASON_REWARDS.stayedActive };
    }
    return { coins: 0, gems: 0 };
  }

  private async grantMasterCosmetic(
    manager: DataSource['manager'],
    userId: string,
  ) {
    const inv = manager.getRepository(UserInventoryItem);
    const existing = await inv.findOne({
      where: { userId, sku: MASTER_TOP3_SKU },
    });
    if (existing) return;
    await inv.save(
      inv.create({
        userId,
        sku: MASTER_TOP3_SKU,
        quantity: 1,
        equipped: false,
        acquiredFrom: 'league_season',
        payload: {
          kind: 'cosmetic',
          slot: 'frame',
          variant: 'master_crown',
          title: SEASON_REWARDS.masterTop3Cosmetic.title,
        },
      }),
    );
  }

  private async notifyResult(
    userId: string,
    outcome: {
      position: number;
      result: LeaguePromotionResult;
      newPlacement: { tier: string; division: string };
    },
    reward: { coins: number; gems: number; cosmeticSku?: string },
  ): Promise<void> {
    const type =
      outcome.result === LeaguePromotionResult.Promoted
        ? NotificationType.LeaguePromoted
        : outcome.result === LeaguePromotionResult.Demoted
          ? NotificationType.LeagueDemoted
          : outcome.result === LeaguePromotionResult.GateBlocked
            ? NotificationType.LeagueGateBlocked
            : NotificationType.LeagueFinalized;

    const title =
      type === NotificationType.LeaguePromoted
        ? 'League promotion!'
        : type === NotificationType.LeagueDemoted
          ? 'League demotion'
          : type === NotificationType.LeagueGateBlocked
            ? 'Promotion gate needed'
            : 'League week results';

    await this.notifications.create({
      userId,
      type,
      title,
      body: `You finished #${outcome.position}. Next: ${outcome.newPlacement.tier} ${outcome.newPlacement.division}.`,
      actionUrl: '/leaderboard',
      payload: { ...outcome, reward },
      force: true,
    });
  }

  private advisoryKey(seasonId: string): number {
    let hash = 0;
    for (let i = 0; i < seasonId.length; i++) {
      hash = (hash * 31 + seasonId.charCodeAt(i)) | 0;
    }
    return hash;
  }

  async finalizeDueSeasons(now = new Date()): Promise<number> {
    const due = await this.seasonService.findSeasonsNeedingFinalization(now);
    let n = 0;
    for (const season of due) {
      await this.finalizeSeason(season.id);
      n += 1;
    }
    return n;
  }
}
