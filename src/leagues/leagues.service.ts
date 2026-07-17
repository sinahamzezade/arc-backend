import { HttpStatus, Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { GamificationService } from '../gamification/gamification.service';
import { Wallet } from '../gamification/entities/wallet.entity';
import { Goal, GoalStatus } from '../goals/entities/goal.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { ProfilesService } from '../profiles/profiles.service';
import { QuestsService } from '../quests/quests.service';
import { RankAvatarService } from '../ranks/rank-avatar.service';
import { SocialPermissionService } from '../social/social-permission.service';
import { User } from '../users/entities/user.entity';
import { LeagueFinalResult } from './entities/league-final-result.entity';
import { LeagueMembership } from './entities/league-membership.entity';
import { LeagueScoreEvent } from './entities/league-score-event.entity';
import { UserLeagueState } from './entities/user-league-state.entity';
import {
  LeaguePrivacyState,
  LeagueScoreSourceType,
  LeagueSeasonStatus,
} from './entities/league.enums';
import { LeagueCohortService } from './league-cohort.service';
import { LeagueFinalizeService } from './league-finalize.service';
import { LeagueLiveScoresService } from './league-live-scores.service';
import { LeagueSummaryCacheService } from './league-summary-cache.service';
import {
  regionalBucketForTimezone,
  timezoneForBucket,
} from './league-season-bounds';
import { LeagueSeasonService } from './league-season.service';
import { LeagueScoreService } from './league-score.service';
import { rankByTieBreak } from './league-tiebreak';
import { promotionCounts, zoneForPosition } from './league-promotion';
import { meetsTierGate, promoteOne } from './league-tiers';
import {
  RISK_NOTIFY_COOLDOWN_MS,
} from './leagues.constants';
import {
  toCurrentLeagueDto,
  toHistoryItemDto,
  toLeaderboardDto,
  toMeDto,
  toPublicUserLeagueDto,
} from './leagues.serializer';

@Injectable()
export class LeaguesService {
  private readonly logger = new Logger(LeaguesService.name);

  constructor(
    @InjectRepository(UserLeagueState)
    private readonly statesRepo: Repository<UserLeagueState>,
    @InjectRepository(LeagueMembership)
    private readonly membershipsRepo: Repository<LeagueMembership>,
    @InjectRepository(LeagueScoreEvent)
    private readonly eventsRepo: Repository<LeagueScoreEvent>,
    @InjectRepository(LeagueFinalResult)
    private readonly resultsRepo: Repository<LeagueFinalResult>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Goal)
    private readonly goalsRepo: Repository<Goal>,
    @InjectRepository(Wallet)
    private readonly walletsRepo: Repository<Wallet>,
    private readonly seasons: LeagueSeasonService,
    private readonly cohorts: LeagueCohortService,
    private readonly scores: LeagueScoreService,
    private readonly finalize: LeagueFinalizeService,
    private readonly liveScores: LeagueLiveScoresService,
    private readonly summaryCache: LeagueSummaryCacheService,
    private readonly profiles: ProfilesService,
    private readonly notifications: NotificationsService,
    private readonly socialPermissions: SocialPermissionService,
    private readonly quests: QuestsService,
    private readonly rankAvatars: RankAvatarService,
    @Optional()
    @Inject(forwardRef(() => GamificationService))
    private readonly gamification?: GamificationService,
  ) {}

  async ensureState(userId: string): Promise<UserLeagueState> {
    let state = await this.statesRepo.findOne({ where: { userId } });
    if (state) return state;

    const profile = await this.profiles.findByUserId(userId);
    const bucket = regionalBucketForTimezone(profile?.timezone);
    state = this.statesRepo.create({
      userId,
      regionalBucket: bucket,
      seasonTimezone: timezoneForBucket(bucket),
      rankLevel: 1,
      weeklySeals: 0,
    });
    return this.statesRepo.save(state);
  }

  /**
   * Ensure user has active season membership. Sticky timezone mid-season.
   */
  async ensureAssignment(userId: string, now = new Date()) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (user?.isAdmin) {
      throw new AppException(
        AuthErrorCode.LEAGUE_NOT_ASSIGNED,
        'Admin accounts are excluded from weekly leagues',
        HttpStatus.FORBIDDEN,
      );
    }

    const state = await this.ensureState(userId);

    if (state.currentMembershipId) {
      const membership = await this.cohorts.findById(state.currentMembershipId);
      if (membership?.cohort) {
        const season = await this.seasons.findById(membership.cohort.seasonId);
        if (
          season &&
          (season.status === LeagueSeasonStatus.Active ||
            season.status === LeagueSeasonStatus.Forming) &&
          now <= season.endsAt
        ) {
          return { state, season, cohort: membership.cohort, membership };
        }
      }
    }

    // Sticky bucket for current season; may refresh next season.
    const bucket =
      state.regionalBucket ??
      regionalBucketForTimezone(
        (await this.profiles.findByUserId(userId))?.timezone,
      );
    if (!state.regionalBucket) {
      state.regionalBucket = bucket;
      state.seasonTimezone = timezoneForBucket(bucket);
    }

    const season = await this.seasons.getOrCreateActiveSeason(bucket, now);
    const { cohort, membership } = await this.cohorts.assignMembership({
      season,
      state,
      now,
    });

    const wasNew = state.currentMembershipId !== membership.id;
    state.currentSeasonId = season.id;
    state.currentMembershipId = membership.id;
    await this.statesRepo.save(state);

    if (wasNew) {
      await this.notifications.create({
        userId,
        type: NotificationType.LeagueStarted,
        title: 'Weekly league started',
        body: `You're in ${cohort.tier} ${cohort.division}. Climb the board!`,
        actionUrl: '/leaderboard',
        payload: {
          seasonId: season.id,
          cohortId: cohort.id,
          tier: cohort.tier,
          division: cohort.division,
        },
      });
      this.logger.log(`league_assigned user=${userId} cohort=${cohort.id}`);
    }

    return { state, season, cohort, membership };
  }

  async getCurrent(userId: string) {
    const { state, season, cohort, membership } =
      await this.ensureAssignment(userId);
    const cached = await this.summaryCache.get<
      Awaited<ReturnType<LeaguesService['getCurrent']>>
    >(userId, cohort.id, 'current');
    if (cached) return cached;

    const peers = await this.cohorts.listMemberships(cohort.id);
    const ranked = rankByTieBreak(peers);
    const activeCount =
      ranked.filter((p) => p.qualifiedXp > 0).length || ranked.length;
    const counts = promotionCounts(activeCount);
    const me = ranked.find((r) => r.userId === userId);

    const breakdown = await this.scoreBreakdown(membership.id);
    const quests = await this.quests.progressForLeague({
      breakdown,
      activeDays: membership.activeDays,
    });

    const result = toCurrentLeagueDto({
      serverTimestamp: new Date(),
      season,
      cohort,
      membership,
      state,
      position: me?.position ?? membership.position ?? 0,
      zones: {
        promoteThrough: counts.promoteCount,
        remainFrom: counts.remainFloor,
        remainThrough: counts.remainCeil,
        demoteFrom: counts.remainCeil + 1,
      },
      topUsers: await this.anonymizePeers(ranked.slice(0, 3), userId),
      surrounding: await this.anonymizePeers(
        this.surrounding(ranked, userId, 2),
        userId,
      ),
      breakdown,
      quests,
    });
    await this.summaryCache.set(userId, cohort.id, 'current', result);
    return result;
  }

  async getLeaderboard(userId: string, cursor?: string) {
    const { season, cohort } = await this.ensureAssignment(userId);
    const peers = await this.cohorts.listMemberships(cohort.id);
    const ranked = rankByTieBreak(peers);

    const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
    const pageSize = 20;
    const page = ranked.slice(offset, offset + pageSize);
    const nextCursor =
      offset + pageSize < ranked.length
        ? String(offset + pageSize)
        : null;

    // Prefer live cache when present; fall back to PG ranking.
    const live = await this.liveScores.getLeaderboard(cohort.id, offset + pageSize);
    if (live.length > 0) {
      const livePage = live.slice(offset, offset + pageSize);
      const liveRanked = livePage.map((row, index) => ({
        userId: row.userId,
        qualifiedXp: row.score,
        position: offset + index + 1,
      }));
      return toLeaderboardDto({
        serverTimestamp: new Date(),
        seasonEndsAt: season.endsAt,
        cohortId: cohort.id,
        entries: await this.anonymizePeers(liveRanked as never, userId),
        nextCursor:
          offset + pageSize < live.length
            ? String(offset + pageSize)
            : null,
      });
    }

    return toLeaderboardDto({
      serverTimestamp: new Date(),
      seasonEndsAt: season.endsAt,
      cohortId: cohort.id,
      entries: await this.anonymizePeers(page, userId),
      nextCursor,
    });
  }

  async getMe(userId: string, scope: 'global' | 'goal' = 'global') {
    if (scope !== 'global' && scope !== 'goal') {
      throw new AppException(
        AuthErrorCode.LEAGUE_SCOPE_INVALID,
        'Unknown league scope',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (scope === 'goal') {
      return this.getMeGoalScope(userId);
    }

    const { state, season, cohort, membership } =
      await this.ensureAssignment(userId);
    const cached = await this.summaryCache.get<
      Awaited<ReturnType<LeaguesService['getMe']>>
    >(userId, cohort.id, 'me');
    if (cached) return cached;

    const peers = await this.cohorts.listMemberships(cohort.id);
    const ranked = rankByTieBreak(peers);
    const me = ranked.find((r) => r.userId === userId);
    const activeCount =
      ranked.filter((p) => p.qualifiedXp > 0).length || ranked.length;
    const position = me?.position ?? membership.position ?? 0;
    const zone = zoneForPosition(position, activeCount);
    const breakdown = await this.scoreBreakdown(membership.id);

    if (zone === 'promote') {
      const next = promoteOne({
        tier: cohort.tier,
        division: cohort.division,
      });
      if (!meetsTierGate(next.tier, state.rankLevel, state.weeklySeals)) {
        this.logger.debug(
          `league_gate_blocked user=${userId} next=${next.tier}`,
        );
      }
    }

    await this.maybeRiskNotify(state, zone, position);

    const result = {
      ...toMeDto({
        serverTimestamp: new Date(),
        season,
        cohort,
        membership,
        state,
        position,
        zone,
        breakdown,
      }),
      gateBlocked:
        zone === 'promote' &&
        !meetsTierGate(
          promoteOne({ tier: cohort.tier, division: cohort.division }).tier,
          state.rankLevel,
          state.weeklySeals,
        ),
      liveBackend: this.liveScores.backend,
    };
    await this.summaryCache.set(userId, cohort.id, 'me', result);
    return result;
  }

  private async getMeGoalScope(userId: string) {
    const { season, cohort } = await this.ensureAssignment(userId);

    const activeGoal = await this.goalsRepo.findOne({
      where: { userId, status: GoalStatus.Active },
      order: { updatedAt: 'DESC' },
    });
    const goalToken = activeGoal?.targetRoles?.[0] ?? null;
    if (!goalToken) {
      throw new AppException(
        AuthErrorCode.GOAL_NOT_FOUND,
        'No active goal for goal-scoped league',
        HttpStatus.NOT_FOUND,
      );
    }

    const peerRows: Array<{ userId: string; weeklyLeagueXp: number }> =
      await this.walletsRepo
        .createQueryBuilder('w')
        .innerJoin(Goal, 'g', 'g.user_id = w.user_id AND g.status = :active', {
          active: GoalStatus.Active,
        })
        .where('g.target_roles[1] = :goalToken', { goalToken })
        .select('w.user_id', 'userId')
        .addSelect('w.weekly_league_xp', 'weeklyLeagueXp')
        .orderBy('w.weekly_league_xp', 'DESC')
        .addOrderBy('w.user_id', 'ASC')
        .getRawMany();

    const profiles = await Promise.all(
      peerRows.map(async (row, index) => {
        const profile = await this.profiles.findByUserId(row.userId);
        const isViewer = row.userId === userId;
        return {
          rank: index + 1,
          displayName: isViewer
            ? (profile?.displayName ?? 'You')
            : (profile?.displayName ??
              profile?.username ??
              'Arc Learner'),
          weeklyXp: row.weeklyLeagueXp,
          isViewer,
        };
      }),
    );

    return {
      scope: 'goal' as const,
      goalToken,
      league: {
        tier: cohort.tier,
        weekStart: season.startsAt.toISOString().slice(0, 10),
      },
      standings: profiles.map(({ rank, displayName, weeklyXp }) => ({
        rank,
        displayName,
        weeklyXp,
      })),
    };
  }

  async getHistory(userId: string, cursor?: string) {
    const state = await this.statesRepo.findOne({ where: { userId } });
    if (state?.currentSeasonId) {
      const season = await this.seasons.findById(state.currentSeasonId);
      if (season?.status === LeagueSeasonStatus.Finalizing) {
        throw new AppException(
          AuthErrorCode.LEAGUE_RESULT_NOT_READY,
          'Season still finalizing',
          HttpStatus.CONFLICT,
        );
      }
    }

    const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
    const limit = 20;
    const [rows, total] = await this.resultsRepo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    const nextCursor =
      offset + limit < total ? String(offset + limit) : null;
    return {
      items: rows.map(toHistoryItemDto),
      nextCursor,
      total,
    };
  }

  async getUserLeague(viewerId: string, targetUserId: string) {
    if (await this.socialPermissions.isBlockedEither(viewerId, targetUserId)) {
      return toPublicUserLeagueDto({
        userId: targetUserId,
        hidden: true,
      });
    }

    const targetState = await this.ensureState(targetUserId);
    if (targetState.hideFromProfile && viewerId !== targetUserId) {
      return toPublicUserLeagueDto({
        userId: targetUserId,
        hidden: true,
      });
    }

    try {
      const assignment = await this.ensureAssignment(targetUserId);
      const peers = await this.cohorts.listMemberships(assignment.cohort.id);
      const ranked = rankByTieBreak(peers);
      const me = ranked.find((r) => r.userId === targetUserId);
      return toPublicUserLeagueDto({
        userId: targetUserId,
        hidden: false,
        tier: assignment.cohort.tier,
        division: assignment.cohort.division,
        position: me?.position ?? null,
        qualifiedXp: assignment.membership.qualifiedXp,
        seasonEndsAt: assignment.season.endsAt,
      });
    } catch {
      return toPublicUserLeagueDto({
        userId: targetUserId,
        hidden: false,
        tier: targetState.tier,
        division: targetState.division,
        position: null,
        qualifiedXp: 0,
        seasonEndsAt: null,
      });
    }
  }

  /**
   * Public hook for gamification outbox consumer.
   */
  async ingestQualifiedXp(input: {
    userId: string;
    ledgerEntryId: string;
    xpDelta: number;
    sourceType: LeagueScoreSourceType;
    sourceId?: string | null;
    occurredAt: Date;
    isProofWeighted?: boolean;
  }) {
    const { state, season, membership } = await this.ensureAssignment(
      input.userId,
      input.occurredAt,
    );
    return this.scores.applyQualifiedXp({
      ...input,
      membershipId: membership.id,
      seasonTimezone: state.seasonTimezone ?? season.seasonTimezone,
      season,
    });
  }

  async setPrivacy(userId: string, hideFromProfile: boolean) {
    const state = await this.ensureState(userId);
    state.hideFromProfile = hideFromProfile;
    await this.statesRepo.save(state);

    if (state.currentMembershipId) {
      await this.membershipsRepo.update(state.currentMembershipId, {
        privacyState: hideFromProfile
          ? LeaguePrivacyState.Hidden
          : LeaguePrivacyState.Visible,
      });
    }
    return { hideFromProfile };
  }

  async updateRankGateInputs(
    userId: string,
    input: { rankLevel?: number; weeklySeals?: number },
  ) {
    const state = await this.ensureState(userId);
    if (input.rankLevel != null) state.rankLevel = input.rankLevel;
    if (input.weeklySeals != null) state.weeklySeals = input.weeklySeals;
    return this.statesRepo.save(state);
  }

  finalizeDueSeasons() {
    return this.finalize.finalizeDueSeasons();
  }

  finalizeSeason(seasonId: string) {
    return this.finalizeWithOutboxDrain(seasonId);
  }

  private async finalizeWithOutboxDrain(seasonId: string) {
    if (this.gamification) {
      await this.gamification.processPendingOutbox(50);
    }
    return this.finalize.finalizeSeason(seasonId);
  }

  private async scoreBreakdown(membershipId: string) {
    const events = await this.eventsRepo.find({
      where: { membershipId },
    });
    const bySource: Record<string, number> = {};
    for (const e of events) {
      bySource[e.sourceType] = (bySource[e.sourceType] ?? 0) + e.xpDelta;
    }
    return bySource;
  }

  private surrounding<T extends { userId: string; position: number }>(
    ranked: T[],
    userId: string,
    radius: number,
  ): T[] {
    const idx = ranked.findIndex((r) => r.userId === userId);
    if (idx < 0) return [];
    return ranked.slice(
      Math.max(0, idx - radius),
      Math.min(ranked.length, idx + radius + 1),
    );
  }

  private async anonymizePeers<
    T extends {
      userId: string;
      position: number;
      qualifiedXp: number;
      privacyState?: LeaguePrivacyState;
    },
  >(peers: T[], viewerId: string) {
    const visibleIds = peers
      .filter(
        (p) =>
          p.userId === viewerId ||
          (p.privacyState !== LeaguePrivacyState.Hidden &&
            p.privacyState !== LeaguePrivacyState.Anonymized),
      )
      .map((p) => p.userId);
    const rankIcons = await this.rankAvatars.iconKeysByUserIds(visibleIds);

    const profiles = await Promise.all(
      peers.map(async (p) => {
        if (p.userId === viewerId) {
          const profile = await this.profiles.findByUserId(p.userId);
          return {
            userId: p.userId,
            position: p.position,
            qualifiedXp: p.qualifiedXp,
            displayName: profile?.displayName ?? 'You',
            username: profile?.username ?? null,
            avatarUrl:
              profile?.avatarUrl ?? rankIcons.get(p.userId) ?? null,
            anonymized: false,
          };
        }

        const blocked = await this.socialPermissions.isBlockedEither(
          viewerId,
          p.userId,
        );
        if (
          blocked ||
          p.privacyState === LeaguePrivacyState.Hidden ||
          p.privacyState === LeaguePrivacyState.Anonymized
        ) {
          return {
            userId: null as string | null,
            position: p.position,
            qualifiedXp: p.qualifiedXp,
            displayName: 'Arc Learner',
            username: null,
            avatarUrl: null,
            anonymized: true,
          };
        }
        const profile = await this.profiles.findByUserId(p.userId);
        return {
          userId: p.userId,
          position: p.position,
          qualifiedXp: p.qualifiedXp,
          displayName: profile?.displayName ?? profile?.username ?? 'Learner',
          username: profile?.username ?? null,
          avatarUrl:
            profile?.avatarUrl ?? rankIcons.get(p.userId) ?? null,
          anonymized: false,
        };
      }),
    );
    return profiles;
  }

  private async maybeRiskNotify(
    state: UserLeagueState,
    zone: 'promote' | 'remain' | 'demote',
    position: number,
  ) {
    if (zone === 'remain') return;
    const now = Date.now();
    const last = state.lastRiskNotifyAt?.getTime() ?? 0;
    if (now - last < RISK_NOTIFY_COOLDOWN_MS) return;

    state.lastRiskNotifyAt = new Date();
    await this.statesRepo.save(state);

    await this.notifications.create({
      userId: state.userId,
      type:
        zone === 'promote'
          ? NotificationType.LeaguePromotionRisk
          : NotificationType.LeagueDemoteRisk,
      title: zone === 'promote' ? 'Promotion zone!' : 'Demotion risk',
      body:
        zone === 'promote'
          ? `You're #${position} — hold your spot to promote.`
          : `You're #${position} — learn today to stay safe.`,
      actionUrl: '/leaderboard',
      payload: { position, zone },
    });
  }
}
