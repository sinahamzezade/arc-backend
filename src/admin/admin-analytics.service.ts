import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Battle } from '../battles/entities/battle.entity';
import { RewardCurrency } from '../gamification/entities/reward-ledger-entry.entity';
import { RewardLedgerEntry } from '../gamification/entities/reward-ledger-entry.entity';
import { Profile } from '../profiles/entities/profile.entity';
import { UserRankState } from '../ranks/entities/user-rank-state.entity';
import { ReferralAttribution } from '../referrals/entities/referral-attribution.entity';
import {
  LessonProgress,
  LessonProgressStatus,
} from '../roadmaps/entities/lesson-progress.entity';
import { User } from '../users/entities/user.entity';

export type NamedCount = { name: string; value: number };
export type DayCount = { day: string; count: number };
export type DayMulti = { day: string; [key: string]: string | number };

@Injectable()
export class AdminAnalyticsService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Profile)
    private readonly profilesRepo: Repository<Profile>,
    @InjectRepository(LessonProgress)
    private readonly progressRepo: Repository<LessonProgress>,
    @InjectRepository(RewardLedgerEntry)
    private readonly ledgerRepo: Repository<RewardLedgerEntry>,
    @InjectRepository(UserRankState)
    private readonly rankStateRepo: Repository<UserRankState>,
    @InjectRepository(Battle)
    private readonly battlesRepo: Repository<Battle>,
    @InjectRepository(ReferralAttribution)
    private readonly referralsRepo: Repository<ReferralAttribution>,
  ) {}

  async getDashboardAnalytics(days = 30) {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);
    since.setUTCHours(0, 0, 0, 0);

    const [
      totals,
      signupsByDay,
      authProviders,
      userStatus,
      questionnaire,
      lessonCompletions,
      xpByReason,
      rankDistribution,
      battlesByDay,
      referralFunnel,
    ] = await Promise.all([
      this.totals(),
      this.signupsByDay(since),
      this.authProviders(),
      this.userStatus(),
      this.questionnaireStatus(),
      this.lessonCompletionsByDay(since),
      this.xpByReason(since),
      this.rankDistribution(),
      this.battlesByDay(since),
      this.referralFunnel(),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      rangeDays: days,
      totals,
      charts: {
        signupsByDay,
        authProviders,
        userStatus,
        questionnaire,
        lessonCompletions,
        xpByReason,
        rankDistribution,
        battlesByDay,
        referralFunnel,
      },
    };
  }

  private async totals() {
    const [users, active, admins, lessonsCompleted, battles, referrals] =
      await Promise.all([
        this.usersRepo.count(),
        this.usersRepo.count({ where: { isActive: true } }),
        this.usersRepo.count({ where: { isAdmin: true } }),
        this.progressRepo.count({
          where: { status: LessonProgressStatus.Completed },
        }),
        this.battlesRepo.count(),
        this.referralsRepo.count(),
      ]);
    return { users, active, admins, lessonsCompleted, battles, referrals };
  }

  private async signupsByDay(since: Date): Promise<DayCount[]> {
    const rows = await this.usersRepo
      .createQueryBuilder('u')
      .select(`TO_CHAR(date_trunc('day', u.created_at), 'YYYY-MM-DD')`, 'day')
      .addSelect('COUNT(*)::int', 'count')
      .where('u.created_at >= :since', { since })
      .groupBy('day')
      .orderBy('day', 'ASC')
      .getRawMany<{ day: string; count: string }>();
    return this.fillDays(
      since,
      rows.map((r) => ({ day: r.day, count: Number(r.count) })),
    );
  }

  private async authProviders(): Promise<NamedCount[]> {
    const rows = await this.usersRepo
      .createQueryBuilder('u')
      .select('u.auth_provider', 'name')
      .addSelect('COUNT(*)::int', 'value')
      .groupBy('u.auth_provider')
      .orderBy('value', 'DESC')
      .getRawMany<{ name: string; value: string }>();
    return rows.map((r) => ({ name: r.name, value: Number(r.value) }));
  }

  private async userStatus(): Promise<NamedCount[]> {
    const rows = await this.usersRepo
      .createQueryBuilder('u')
      .select(
        `CASE WHEN u.is_active THEN 'Active' ELSE 'Suspended' END`,
        'name',
      )
      .addSelect('COUNT(*)::int', 'value')
      .groupBy('name')
      .getRawMany<{ name: string; value: string }>();
    return rows.map((r) => ({ name: r.name, value: Number(r.value) }));
  }

  private async questionnaireStatus(): Promise<NamedCount[]> {
    const rows = await this.profilesRepo
      .createQueryBuilder('p')
      .select('p.questionnaire_status', 'name')
      .addSelect('COUNT(*)::int', 'value')
      .groupBy('p.questionnaire_status')
      .orderBy('value', 'DESC')
      .getRawMany<{ name: string; value: string }>();
    return rows.map((r) => ({
      name: String(r.name).replace(/_/g, ' '),
      value: Number(r.value),
    }));
  }

  private async lessonCompletionsByDay(since: Date): Promise<DayCount[]> {
    const rows = await this.progressRepo
      .createQueryBuilder('lp')
      .select(
        `TO_CHAR(date_trunc('day', lp.completed_at), 'YYYY-MM-DD')`,
        'day',
      )
      .addSelect('COUNT(*)::int', 'count')
      .where('lp.status = :status', { status: LessonProgressStatus.Completed })
      .andWhere('lp.completed_at IS NOT NULL')
      .andWhere('lp.completed_at >= :since', { since })
      .groupBy('day')
      .orderBy('day', 'ASC')
      .getRawMany<{ day: string; count: string }>();
    return this.fillDays(
      since,
      rows.map((r) => ({ day: r.day, count: Number(r.count) })),
    );
  }

  private async xpByReason(since: Date): Promise<NamedCount[]> {
    const rows = await this.ledgerRepo
      .createQueryBuilder('e')
      .select('e.reason_type', 'name')
      .addSelect('COALESCE(SUM(e.amount), 0)::int', 'value')
      .where('e.currency = :currency', { currency: RewardCurrency.LifetimeXp })
      .andWhere('e.created_at >= :since', { since })
      .groupBy('e.reason_type')
      .orderBy('value', 'DESC')
      .limit(8)
      .getRawMany<{ name: string; value: string }>();
    return rows.map((r) => ({
      name: String(r.name).replace(/_/g, ' '),
      value: Number(r.value),
    }));
  }

  private async rankDistribution(): Promise<NamedCount[]> {
    const rows = await this.rankStateRepo
      .createQueryBuilder('r')
      .select('r.current_rank_slug', 'name')
      .addSelect('COUNT(*)::int', 'value')
      .addSelect('MIN(r.current_rank_level)', 'level')
      .groupBy('r.current_rank_slug')
      .orderBy('level', 'ASC')
      .getRawMany<{ name: string; value: string }>();
    return rows.map((r) => ({
      name: String(r.name).replace(/-/g, ' '),
      value: Number(r.value),
    }));
  }

  private async battlesByDay(since: Date): Promise<DayCount[]> {
    const rows = await this.battlesRepo
      .createQueryBuilder('b')
      .select(`TO_CHAR(date_trunc('day', b.created_at), 'YYYY-MM-DD')`, 'day')
      .addSelect('COUNT(*)::int', 'count')
      .where('b.created_at >= :since', { since })
      .groupBy('day')
      .orderBy('day', 'ASC')
      .getRawMany<{ day: string; count: string }>();
    return this.fillDays(
      since,
      rows.map((r) => ({ day: r.day, count: Number(r.count) })),
    );
  }

  private async referralFunnel(): Promise<NamedCount[]> {
    const rows = await this.referralsRepo
      .createQueryBuilder('a')
      .select('a.status', 'name')
      .addSelect('COUNT(*)::int', 'value')
      .groupBy('a.status')
      .orderBy('value', 'DESC')
      .getRawMany<{ name: string; value: string }>();
    return rows.map((r) => ({
      name: String(r.name).replace(/_/g, ' '),
      value: Number(r.value),
    }));
  }

  private fillDays(since: Date, rows: DayCount[]): DayCount[] {
    const map = new Map(rows.map((r) => [r.day, r.count]));
    const out: DayCount[] = [];
    const cursor = new Date(since);
    const end = new Date();
    end.setUTCHours(0, 0, 0, 0);
    while (cursor <= end) {
      const day = cursor.toISOString().slice(0, 10);
      out.push({ day, count: map.get(day) ?? 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
  }
}
