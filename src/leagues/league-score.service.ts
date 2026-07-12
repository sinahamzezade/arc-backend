import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThanOrEqual, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { LeagueMembership } from './entities/league-membership.entity';
import { LeagueScoreEvent } from './entities/league-score-event.entity';
import { LeagueSeason } from './entities/league-season.entity';
import {
  LeagueScoreSourceType,
  LeagueSeasonStatus,
} from './entities/league.enums';
import { UserLeagueState } from './entities/user-league-state.entity';
import { LeagueLiveScoresService } from './league-live-scores.service';
import { localDayKey, isWithinSeason } from './league-season-bounds';
import { rankByTieBreak } from './league-tiebreak';
import {
  BATTLE_LEAGUE_XP_CAP,
  POSITION_NOTIFY_COOLDOWN_MS,
  POSITION_NOTIFY_MIN_DELTA,
  SCORE_EVENT_GRACE_MS,
  VELOCITY_WINDOW_MS,
  VELOCITY_XP_PER_HOUR,
} from './leagues.constants';
import { zoneForPosition } from './league-promotion';

export type QualifiedLeagueXpInput = {
  userId: string;
  membershipId: string;
  ledgerEntryId: string;
  xpDelta: number;
  sourceType: LeagueScoreSourceType;
  sourceId?: string | null;
  occurredAt: Date;
  isProofWeighted?: boolean;
  /** Season timezone for active-day key */
  seasonTimezone: string;
  season: LeagueSeason;
};

const PROOF_SOURCES = new Set([
  LeagueScoreSourceType.Challenge,
  LeagueScoreSourceType.Project,
  LeagueScoreSourceType.Assessment,
]);

@Injectable()
export class LeagueScoreService {
  private readonly logger = new Logger(LeagueScoreService.name);
  private readonly battleXpByMembership = new Map<string, number>();

  constructor(
    @InjectRepository(LeagueScoreEvent)
    private readonly eventsRepo: Repository<LeagueScoreEvent>,
    @InjectRepository(LeagueMembership)
    private readonly membershipsRepo: Repository<LeagueMembership>,
    private readonly dataSource: DataSource,
    private readonly liveScores: LeagueLiveScoresService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Ingest qualified League XP from gamification ledger (countsForLeague=true).
   * Idempotent on ledgerEntryId.
   */
  async applyQualifiedXp(input: QualifiedLeagueXpInput): Promise<LeagueScoreEvent> {
    const season = input.season;
    if (
      season.status === LeagueSeasonStatus.Finalizing ||
      season.status === LeagueSeasonStatus.Finalized
    ) {
      throw new AppException(
        AuthErrorCode.LEAGUE_FINALIZING,
        'League season is finalizing or finalized',
        HttpStatus.CONFLICT,
      );
    }
    if (season.status !== LeagueSeasonStatus.Active) {
      throw new AppException(
        AuthErrorCode.LEAGUE_SEASON_NOT_ACTIVE,
        'League season is not active',
        HttpStatus.CONFLICT,
      );
    }

    const now = new Date();
    if (
      !isWithinSeason(
        input.occurredAt,
        season.startsAt,
        season.endsAt,
        now,
        SCORE_EVENT_GRACE_MS,
      )
    ) {
      throw new AppException(
        AuthErrorCode.LEAGUE_SEASON_NOT_ACTIVE,
        'Score event outside season window',
        HttpStatus.CONFLICT,
      );
    }

    const existing = await this.eventsRepo.findOne({
      where: { ledgerEntryId: input.ledgerEntryId },
    });
    if (existing) {
      throw new AppException(
        AuthErrorCode.LEAGUE_SCORE_EVENT_DUPLICATE,
        'Ledger entry already applied to league',
        HttpStatus.CONFLICT,
      );
    }

    // Velocity soft-hold: rolling hour XP over cap → reject (anti-cheat)
    const since = new Date(Date.now() - VELOCITY_WINDOW_MS);
    const recent = await this.eventsRepo.find({
      where: {
        membershipId: input.membershipId,
        occurredAt: MoreThanOrEqual(since),
      },
    });
    const recentXp = recent.reduce((s, e) => s + e.xpDelta, 0);
    if (recentXp + input.xpDelta > VELOCITY_XP_PER_HOUR) {
      this.logger.warn(
        `league_velocity_hold membership=${input.membershipId} recent=${recentXp} delta=${input.xpDelta}`,
      );
      throw new AppException(
        AuthErrorCode.LEAGUE_SEASON_NOT_ACTIVE,
        'League XP velocity hold — try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    let xpDelta = input.xpDelta;
    if (input.sourceType === LeagueScoreSourceType.Battle) {
      const used = this.battleXpByMembership.get(input.membershipId) ?? 0;
      const remaining = Math.max(0, BATTLE_LEAGUE_XP_CAP - used);
      xpDelta = Math.min(xpDelta, remaining);
      this.battleXpByMembership.set(input.membershipId, used + xpDelta);
      if (xpDelta <= 0) {
        throw new AppException(
          AuthErrorCode.LEAGUE_SEASON_NOT_ACTIVE,
          'Battle League XP cap reached',
          HttpStatus.CONFLICT,
        );
      }
    }

    const isProof =
      input.isProofWeighted ?? PROOF_SOURCES.has(input.sourceType);

    return this.dataSource.transaction(async (manager) => {
      const membership = await manager.findOne(LeagueMembership, {
        where: { id: input.membershipId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!membership || membership.userId !== input.userId) {
        throw new AppException(
          AuthErrorCode.LEAGUE_NOT_ASSIGNED,
          'League membership not found',
          HttpStatus.NOT_FOUND,
        );
      }

      const prevPosition = membership.position;
      const seq = await manager.count(LeagueScoreEvent, {
        where: { membershipId: membership.id },
      });

      const event = manager.create(LeagueScoreEvent, {
        membershipId: membership.id,
        ledgerEntryId: input.ledgerEntryId,
        xpDelta,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        occurredAt: input.occurredAt,
        sequence: String(seq + 1),
        isProofWeighted: isProof,
      });
      await manager.save(event);

      membership.qualifiedXp += xpDelta;
      if (isProof) membership.proofWeightedXp += xpDelta;
      membership.lastScoreEventAt = input.occurredAt;
      membership.finalXpReachedAt = input.occurredAt;

      const dayKey = localDayKey(input.occurredAt, input.seasonTimezone);
      const days = new Set(membership.activeDayKeys ?? []);
      days.add(dayKey);
      membership.activeDayKeys = [...days];
      membership.activeDays = days.size;

      await manager.save(membership);

      // Recompute positions for cohort (PG authoritative).
      const peers = await manager.find(LeagueMembership, {
        where: { cohortId: membership.cohortId },
      });
      const ranked = rankByTieBreak(peers);
      for (const row of ranked) {
        await manager.update(LeagueMembership, row.id, {
          position: row.position,
        });
      }

      const self = ranked.find((r) => r.id === membership.id);
      const newPosition = self?.position ?? membership.position;

      await this.liveScores.setScore(
        membership.cohortId,
        membership.userId,
        membership.qualifiedXp,
      );
      await this.liveScores.publishCohortUpdate(membership.cohortId, {
        userId: membership.userId,
        qualifiedXp: membership.qualifiedXp,
        position: newPosition,
      });

      if (
        prevPosition != null &&
        newPosition != null &&
        Math.abs(prevPosition - newPosition) >= POSITION_NOTIFY_MIN_DELTA
      ) {
        const state = await manager.findOne(UserLeagueState, {
          where: { userId: membership.userId },
        });
        const lastNotify = state?.lastPositionNotifyAt?.getTime() ?? 0;
        const cooled =
          Date.now() - lastNotify >= POSITION_NOTIFY_COOLDOWN_MS;
        if (cooled) {
          if (state) {
            state.lastPositionNotifyAt = new Date();
            await manager.save(state);
          }
          void this.notifications.create({
            userId: membership.userId,
            type: NotificationType.LeaguePositionChanged,
            title: 'League position update',
            body: `You moved to #${newPosition} in your league.`,
            actionUrl: '/leaderboard',
            payload: {
              previousPosition: prevPosition,
              position: newPosition,
              cohortId: membership.cohortId,
            },
          });
        }
      }

      const activeCount = peers.filter((p) => p.qualifiedXp > 0).length || peers.length;
      if (newPosition != null) {
        const zone = zoneForPosition(newPosition, activeCount);
        if (zone === 'promote' || zone === 'demote') {
          // Risk notify handled by LeaguesService with cooldown on user state.
          this.logger.debug(
            `user=${membership.userId} zone=${zone} pos=${newPosition}`,
          );
        }
      }

      this.logger.log(
        `league_score_added user=${membership.userId} xp=+${xpDelta} total=${membership.qualifiedXp}`,
      );

      return event;
    });
  }
}
