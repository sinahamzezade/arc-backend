import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DEFAULT_COHORT_SIZE,
  DEMOTE_RATIO,
  FULL_COHORT_DEMOTE,
  FULL_COHORT_PROMOTE,
  PROMOTE_RATIO,
} from './leagues.constants';
import { LeagueSeason } from './entities/league-season.entity';
import {
  LeagueRegionalBucket,
  LeagueSeasonStatus,
} from './entities/league.enums';
import {
  seasonBoundsForTimezone,
  timezoneForBucket,
} from './league-season-bounds';

@Injectable()
export class LeagueSeasonService {
  constructor(
    @InjectRepository(LeagueSeason)
    private readonly seasonsRepo: Repository<LeagueSeason>,
  ) {}

  async getOrCreateActiveSeason(
    bucket: LeagueRegionalBucket,
    now = new Date(),
  ): Promise<LeagueSeason> {
    const timezone = timezoneForBucket(bucket);
    const { startsAt, endsAt } = seasonBoundsForTimezone(now, timezone);

    const existing = await this.seasonsRepo.findOne({
      where: {
        regionalBucket: bucket,
        startsAt,
      },
    });
    if (existing) {
      if (
        existing.status === LeagueSeasonStatus.Forming &&
        now >= existing.startsAt
      ) {
        existing.status = LeagueSeasonStatus.Active;
        return this.seasonsRepo.save(existing);
      }
      return existing;
    }

    const season = this.seasonsRepo.create({
      regionalBucket: bucket,
      seasonTimezone: timezone,
      startsAt,
      endsAt,
      status:
        now >= startsAt
          ? LeagueSeasonStatus.Active
          : LeagueSeasonStatus.Forming,
      configSnapshot: {
        cohortSize: DEFAULT_COHORT_SIZE,
        promoteCountFull: FULL_COHORT_PROMOTE,
        demoteCountFull: FULL_COHORT_DEMOTE,
        promoteRatio: PROMOTE_RATIO,
        demoteRatio: DEMOTE_RATIO,
      },
    });
    return this.seasonsRepo.save(season);
  }

  async findById(id: string): Promise<LeagueSeason | null> {
    return this.seasonsRepo.findOne({ where: { id } });
  }

  async markFinalizing(season: LeagueSeason): Promise<LeagueSeason> {
    season.status = LeagueSeasonStatus.Finalizing;
    return this.seasonsRepo.save(season);
  }

  async markFinalized(season: LeagueSeason): Promise<LeagueSeason> {
    season.status = LeagueSeasonStatus.Finalized;
    return this.seasonsRepo.save(season);
  }

  async findSeasonsNeedingFinalization(now = new Date()): Promise<LeagueSeason[]> {
    return this.seasonsRepo
      .createQueryBuilder('s')
      .where('s.status = :status', { status: LeagueSeasonStatus.Active })
      .andWhere('s.ends_at < :now', { now })
      .getMany();
  }
}
