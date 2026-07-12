import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DEFAULT_COHORT_SIZE, INACTIVE_EMPTY_SEASONS } from './leagues.constants';
import { LeagueCohort } from './entities/league-cohort.entity';
import { LeagueMembership } from './entities/league-membership.entity';
import { UserLeagueState } from './entities/user-league-state.entity';
import {
  LeagueCohortStatus,
  LeagueDivision,
  LeaguePrivacyState,
  LeagueTier,
} from './entities/league.enums';
import { LeagueSeason } from './entities/league-season.entity';

@Injectable()
export class LeagueCohortService {
  private readonly logger = new Logger(LeagueCohortService.name);

  constructor(
    @InjectRepository(LeagueCohort)
    private readonly cohortsRepo: Repository<LeagueCohort>,
    @InjectRepository(LeagueMembership)
    private readonly membershipsRepo: Repository<LeagueMembership>,
  ) {}

  /**
   * Place user into an open cohort for their tier/division, or create one.
   * Late joiners (season already active > 24h) go to late_start cohorts.
   */
  async assignMembership(params: {
    season: LeagueSeason;
    state: UserLeagueState;
    now?: Date;
  }): Promise<{ cohort: LeagueCohort; membership: LeagueMembership }> {
    const now = params.now ?? new Date();
    const { season, state } = params;

    if (state.isInactive || state.emptySeasons >= INACTIVE_EMPTY_SEASONS) {
      return this.assignInactive(season, state, now);
    }

    const lateMs = 24 * 60 * 60 * 1000;
    const isLate =
      now.getTime() - season.startsAt.getTime() > lateMs &&
      season.status === 'active';

    const status = isLate
      ? LeagueCohortStatus.LateStart
      : LeagueCohortStatus.Active;

    let cohort = await this.findOpenCohort(
      season.id,
      state.tier,
      state.division,
      status,
    );

    if (!cohort) {
      cohort = await this.cohortsRepo.save(
        this.cohortsRepo.create({
          seasonId: season.id,
          tier: state.tier,
          division: state.division,
          maxMembers: DEFAULT_COHORT_SIZE,
          status,
          seedMetadata: {
            rankLevelBand: Math.floor(state.rankLevel / 2),
            xpBand: Math.floor(state.recentQualifiedXp / 100),
            language: null,
          },
        }),
      );
      this.logger.log(
        `Created cohort=${cohort.id} tier=${state.tier}/${state.division}`,
      );
    }

    const existing = await this.membershipsRepo.findOne({
      where: { cohortId: cohort.id, userId: state.userId },
    });
    if (existing) {
      return { cohort, membership: existing };
    }

    const memberCount = await this.membershipsRepo.count({
      where: { cohortId: cohort.id },
    });

    const membership = await this.membershipsRepo.save(
      this.membershipsRepo.create({
        cohortId: cohort.id,
        userId: state.userId,
        startingRank: memberCount + 1,
        qualifiedXp: 0,
        proofWeightedXp: 0,
        activeDays: 0,
        activeDayKeys: [],
        position: memberCount + 1,
        privacyState: state.hideFromProfile
          ? LeaguePrivacyState.Hidden
          : LeaguePrivacyState.Visible,
        joinedAt: now,
        lastScoreEventAt: null,
        finalXpReachedAt: null,
      }),
    );

    return { cohort, membership };
  }

  private async assignInactive(
    season: LeagueSeason,
    state: UserLeagueState,
    now: Date,
  ): Promise<{ cohort: LeagueCohort; membership: LeagueMembership }> {
    let cohort = await this.findOpenCohort(
      season.id,
      LeagueTier.Bronze,
      LeagueDivision.III,
      LeagueCohortStatus.Inactive,
    );
    if (!cohort) {
      cohort = await this.cohortsRepo.save(
        this.cohortsRepo.create({
          seasonId: season.id,
          tier: LeagueTier.Bronze,
          division: LeagueDivision.III,
          maxMembers: DEFAULT_COHORT_SIZE,
          status: LeagueCohortStatus.Inactive,
          seedMetadata: { inactive: true },
        }),
      );
    }

    const existing = await this.membershipsRepo.findOne({
      where: { cohortId: cohort.id, userId: state.userId },
    });
    if (existing) return { cohort, membership: existing };

    const membership = await this.membershipsRepo.save(
      this.membershipsRepo.create({
        cohortId: cohort.id,
        userId: state.userId,
        startingRank: 0,
        joinedAt: now,
        privacyState: LeaguePrivacyState.Anonymized,
        activeDayKeys: [],
      }),
    );
    return { cohort, membership };
  }

  private async findOpenCohort(
    seasonId: string,
    tier: LeagueTier,
    division: LeagueDivision,
    status: LeagueCohortStatus,
  ): Promise<LeagueCohort | null> {
    const cohorts = await this.cohortsRepo.find({
      where: { seasonId, tier, division, status },
      order: { createdAt: 'ASC' },
    });

    for (const cohort of cohorts) {
      const count = await this.membershipsRepo.count({
        where: { cohortId: cohort.id },
      });
      if (count < cohort.maxMembers) return cohort;
    }
    return null;
  }

  async listMemberships(cohortId: string): Promise<LeagueMembership[]> {
    return this.membershipsRepo.find({
      where: { cohortId },
      order: { qualifiedXp: 'DESC', finalXpReachedAt: 'ASC' },
    });
  }

  async findMembershipForUser(
    seasonId: string,
    userId: string,
  ): Promise<(LeagueMembership & { cohort: LeagueCohort }) | null> {
    return this.membershipsRepo
      .createQueryBuilder('m')
      .innerJoinAndSelect('m.cohort', 'c')
      .where('m.user_id = :userId', { userId })
      .andWhere('c.season_id = :seasonId', { seasonId })
      .getOne();
  }

  async findById(membershipId: string): Promise<LeagueMembership | null> {
    return this.membershipsRepo.findOne({
      where: { id: membershipId },
      relations: { cohort: true },
    });
  }
}
