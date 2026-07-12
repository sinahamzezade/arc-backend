import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { Profile } from '../profiles/entities/profile.entity';
import {
  localParts,
  resolveTz,
  toDateString,
} from '../weeks/weeks.time';
import {
  StreakDay,
  StreakDayStatus,
} from './entities/streak-day.entity';
import { StreakState } from './entities/streak-state.entity';
import { UserInventoryItem } from './entities/user-inventory-item.entity';
import {
  RewardCurrency,
  RewardReasonType,
} from './entities/reward-ledger-entry.entity';
import { RewardLedgerService } from './reward-ledger.service';

const RECOVERY_HOURS = 48;
const MAX_CONSECUTIVE_PROTECTED = 3;
const RESTORE_PRICES: Record<1 | 2 | 3, number> = {
  1: 80,
  2: 150,
  3: 220,
};

@Injectable()
export class StreakService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StreakService.name);
  private tickHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: RewardLedgerService,
    @InjectRepository(StreakState)
    private readonly stateRepo: Repository<StreakState>,
    @InjectRepository(StreakDay)
    private readonly daysRepo: Repository<StreakDay>,
  ) {
    void this.daysRepo;
  }

  onModuleInit() {
    if (process.env.STREAK_TICK === 'false') return;
    this.tickHandle = setInterval(() => {
      void this.closeMissedDays().catch((err) =>
        this.logger.warn(
          `Streak tick failed: ${err instanceof Error ? err.message : err}`,
        ),
      );
    }, 15 * 60_000);
  }

  onModuleDestroy() {
    if (this.tickHandle) clearInterval(this.tickHandle);
  }

  async getStreak(userId: string) {
    return this.dataSource.transaction(async (manager) => {
      const state = await this.ensureState(manager, userId);
      const recent = await manager.getRepository(StreakDay).find({
        where: { userId },
        order: { localDate: 'DESC' },
        take: 14,
      });
      return {
        dailyStreak: state.dailyStreak,
        weeklyStreak: state.weeklyStreak,
        longestDailyStreak: state.longestDailyStreak,
        lastQualifiedDay: state.lastQualifiedDay,
        recoveryWindowEndsAt: state.recoveryWindowEndsAt,
        consecutiveProtectedDays: state.consecutiveProtectedDays,
        version: state.version,
        recentDays: recent.map((d) => ({
          localDate: d.localDate,
          status: d.status,
        })),
      };
    });
  }

  /**
   * Qualify local streak day after meaningful action (lesson complete).
   * Day boundary = local 03:00 (activity before 03:00 counts as previous day).
   */
  async qualifyInTx(
    manager: EntityManager,
    input: {
      userId: string;
      actionType: string;
      actionId: string;
      timezone?: string | null;
      at?: Date;
    },
  ): Promise<{ qualified: boolean; dailyStreak: number; localDate: string }> {
    const profile = await manager.getRepository(Profile).findOne({
      where: { userId: input.userId },
    });
    const tz = resolveTz(input.timezone ?? profile?.timezone);
    const at = input.at ?? new Date();
    const localDate = this.streakLocalDate(at, tz);

    const state = await this.ensureState(manager, input.userId, true);
    const dayRepo = manager.getRepository(StreakDay);

    const existing = await dayRepo.findOne({
      where: { userId: input.userId, localDate },
    });
    if (
      existing &&
      (existing.status === StreakDayStatus.Completed ||
        existing.status === StreakDayStatus.Recovered)
    ) {
      return {
        qualified: false,
        dailyStreak: state.dailyStreak,
        localDate,
      };
    }

    if (existing) {
      existing.status = StreakDayStatus.Completed;
      existing.qualifyingActionType = input.actionType;
      existing.qualifyingActionId = input.actionId;
      existing.timezoneSnapshot = tz;
      await dayRepo.save(existing);
    } else {
      await dayRepo.save(
        dayRepo.create({
          userId: input.userId,
          localDate,
          status: StreakDayStatus.Completed,
          qualifyingActionType: input.actionType,
          qualifyingActionId: input.actionId,
          timezoneSnapshot: tz,
        }),
      );
    }

    const prev = this.addDays(localDate, -1);
    if (state.lastQualifiedDay === localDate) {
      /* already counted */
    } else if (
      state.lastQualifiedDay === prev ||
      state.lastQualifiedDay == null
    ) {
      state.dailyStreak =
        state.lastQualifiedDay == null ? 1 : state.dailyStreak + 1;
    } else {
      state.dailyStreak = 1;
    }

    state.lastQualifiedDay = localDate;
    state.longestDailyStreak = Math.max(
      state.longestDailyStreak,
      state.dailyStreak,
    );
    state.consecutiveProtectedDays = 0;
    state.recoveryWindowEndsAt = null;
    state.version += 1;
    await manager.getRepository(StreakState).save(state);

    if (profile && profile.weeklyStreak !== state.weeklyStreak) {
      // weekly owned by seal; keep mirror if seal bumped profile first
      state.weeklyStreak = Math.max(state.weeklyStreak, profile.weeklyStreak);
      await manager.getRepository(StreakState).save(state);
    }

    return {
      qualified: true,
      dailyStreak: state.dailyStreak,
      localDate,
    };
  }

  async restore(input: {
    userId: string;
    days: 1 | 2 | 3;
    idempotencyKey: string;
  }) {
    const price = RESTORE_PRICES[input.days];
    return this.dataSource.transaction(async (manager) => {
      const state = await this.ensureState(manager, input.userId, true);
      const profile = await manager.getRepository(Profile).findOne({
        where: { userId: input.userId },
      });
      const tz = resolveTz(profile?.timezone);
      const today = this.streakLocalDate(new Date(), tz);

      if (
        !state.recoveryWindowEndsAt ||
        state.recoveryWindowEndsAt.getTime() < Date.now()
      ) {
        // open window if last miss recent
        if (!state.lastQualifiedDay) {
          throw new AppException(
            AuthErrorCode.STREAK_NOT_RECOVERABLE,
            'No streak to restore',
          );
        }
        const gap = this.diffDays(state.lastQualifiedDay, today);
        if (gap < 2 || gap > input.days + 1) {
          throw new AppException(
            AuthErrorCode.STREAK_NOT_RECOVERABLE,
            'Missed days outside recovery window',
          );
        }
        state.recoveryWindowEndsAt = new Date(
          Date.now() + RECOVERY_HOURS * 3600_000,
        );
      }

      if (input.days === 3) {
        const monthKey = today.slice(0, 7);
        const prior = await this.ledger.findByIdempotencyPrefix(
          manager,
          input.userId,
          `streak-restore-3d:${monthKey}`,
        );
        if (prior) {
          throw new AppException(
            AuthErrorCode.PURCHASE_LIMIT_REACHED,
            '3-day restore once per month',
          );
        }
      }

      const wallet = await this.ledger.ensureWallet(manager, input.userId, true);
      if (wallet.gems < price) {
        throw new AppException(
          AuthErrorCode.INSUFFICIENT_GEMS,
          'Insufficient gems',
        );
      }

      const grant = await this.ledger.grantReward(manager, {
        userId: input.userId,
        reasonType: RewardReasonType.Streak,
        reasonId: state.id,
        idempotencyKey:
          input.days === 3
            ? `streak-restore-3d:${today.slice(0, 7)}`
            : `streak-restore:${input.idempotencyKey}`,
        metadata: { days: input.days, price },
        lines: [
          {
            currency: RewardCurrency.Gems,
            amount: -price,
            idempotencySuffix: 'gems',
          },
        ],
      });

      if (!grant.alreadyGranted) {
        for (let i = input.days; i >= 1; i -= 1) {
          const d = this.addDays(today, -i);
          if (d === state.lastQualifiedDay) continue;
          await this.upsertDay(manager, {
            userId: input.userId,
            localDate: d,
            status: StreakDayStatus.Recovered,
            tz,
          });
        }
        state.dailyStreak += input.days;
        state.longestDailyStreak = Math.max(
          state.longestDailyStreak,
          state.dailyStreak,
        );
        state.lastQualifiedDay = this.addDays(today, -1);
        state.recoveryWindowEndsAt = null;
        state.version += 1;
        await manager.getRepository(StreakState).save(state);
      }

      return {
        alreadyRestored: grant.alreadyGranted,
        wallet: grant.wallet,
        dailyStreak: state.dailyStreak,
        lastQualifiedDay: state.lastQualifiedDay,
      };
    });
  }

  /** Sync weekly streak from week seal. */
  async bumpWeeklyInTx(manager: EntityManager, userId: string) {
    const state = await this.ensureState(manager, userId, true);
    state.weeklyStreak += 1;
    state.version += 1;
    await manager.getRepository(StreakState).save(state);
    return state.weeklyStreak;
  }

  async closeMissedDays(limit = 50): Promise<number> {
    const states = await this.stateRepo.find({
      order: { updatedAt: 'ASC' },
      take: limit,
    });
    let n = 0;
    for (const s of states) {
      try {
        const changed = await this.dataSource.transaction((m) =>
          this.closeOneUser(m, s.userId),
        );
        if (changed) n += 1;
      } catch (err) {
        this.logger.warn(
          `closeMissed ${s.userId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return n;
  }

  private async closeOneUser(
    manager: EntityManager,
    userId: string,
  ): Promise<boolean> {
    const profile = await manager.getRepository(Profile).findOne({
      where: { userId },
    });
    const tz = resolveTz(profile?.timezone);
    const now = new Date();
    const parts = localParts(now, tz);
    // Only close after local 03:00
    if (parts.hour < 3) return false;

    const today = toDateString(parts.y, parts.m, parts.d);
    const yesterday = this.addDays(today, -1);
    const state = await this.ensureState(manager, userId, true);
    if (!state.lastQualifiedDay) return false;
    if (state.lastQualifiedDay >= yesterday) return false;

    const dayRepo = manager.getRepository(StreakDay);
    const yDay = await dayRepo.findOne({
      where: { userId, localDate: yesterday },
    });
    if (
      yDay &&
      (yDay.status === StreakDayStatus.Completed ||
        yDay.status === StreakDayStatus.Protected ||
        yDay.status === StreakDayStatus.Recovered)
    ) {
      return false;
    }

    const freeze = await this.consumeFreeze(manager, userId);
    if (
      freeze &&
      state.consecutiveProtectedDays < MAX_CONSECUTIVE_PROTECTED
    ) {
      await this.upsertDay(manager, {
        userId,
        localDate: yesterday,
        status: StreakDayStatus.Protected,
        tz,
        freezeInventoryId: freeze.id,
      });
      state.consecutiveProtectedDays += 1;
      state.lastQualifiedDay = yesterday;
      state.version += 1;
      await manager.getRepository(StreakState).save(state);
      return true;
    }

    await this.upsertDay(manager, {
      userId,
      localDate: yesterday,
      status: StreakDayStatus.Missed,
      tz,
    });
    state.dailyStreak = 0;
    state.consecutiveProtectedDays = 0;
    state.recoveryWindowEndsAt = new Date(
      Date.now() + RECOVERY_HOURS * 3600_000,
    );
    state.version += 1;
    await manager.getRepository(StreakState).save(state);
    return true;
  }

  private async consumeFreeze(
    manager: EntityManager,
    userId: string,
  ): Promise<UserInventoryItem | null> {
    const rows = await manager.getRepository(UserInventoryItem).find({
      where: { userId },
      order: { acquiredAt: 'ASC' },
    });
    const freeze = rows.find(
      (r) =>
        r.quantity > 0 &&
        (r.payload?.kind === 'streak_freeze' ||
          r.sku.startsWith('freeze-') ||
          r.sku === 'weekend-shield'),
    );
    if (!freeze) return null;
    freeze.quantity -= 1;
    if (freeze.quantity <= 0) {
      await manager.getRepository(UserInventoryItem).remove(freeze);
    } else {
      await manager.getRepository(UserInventoryItem).save(freeze);
    }
    return freeze;
  }

  private async upsertDay(
    manager: EntityManager,
    input: {
      userId: string;
      localDate: string;
      status: StreakDayStatus;
      tz: string;
      freezeInventoryId?: string;
    },
  ) {
    const repo = manager.getRepository(StreakDay);
    let row = await repo.findOne({
      where: { userId: input.userId, localDate: input.localDate },
    });
    if (!row) {
      row = repo.create({
        userId: input.userId,
        localDate: input.localDate,
        status: input.status,
        timezoneSnapshot: input.tz,
        freezeInventoryId: input.freezeInventoryId ?? null,
      });
    } else {
      row.status = input.status;
      row.timezoneSnapshot = input.tz;
      if (input.freezeInventoryId) {
        row.freezeInventoryId = input.freezeInventoryId;
      }
    }
    await repo.save(row);
  }

  private async ensureState(
    manager: EntityManager,
    userId: string,
    forUpdate = false,
  ): Promise<StreakState> {
    const repo = manager.getRepository(StreakState);
    let state = forUpdate
      ? await repo.findOne({
          where: { userId },
          lock: { mode: 'pessimistic_write' },
        })
      : await repo.findOne({ where: { userId } });
    if (state) return state;

    const profile = await manager.getRepository(Profile).findOne({
      where: { userId },
    });
    state = repo.create({
      userId,
      dailyStreak: 0,
      weeklyStreak: profile?.weeklyStreak ?? 0,
      longestDailyStreak: 0,
    });
    return repo.save(state);
  }

  /** Local calendar day for streak, shifted so hour < 03:00 → previous day. */
  streakLocalDate(at: Date, timeZone: string): string {
    const p = localParts(at, timeZone);
    let y = p.y;
    let m = p.m;
    let d = p.d;
    if (p.hour < 3) {
      const prev = new Date(Date.UTC(y, m - 1, d - 1, 12));
      const pp = localParts(prev, timeZone);
      y = pp.y;
      m = pp.m;
      d = pp.d;
    }
    return toDateString(y, m, d);
  }

  private addDays(ymd: string, delta: number): string {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + delta, 12));
    return toDateString(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  private diffDays(from: string, to: string): number {
    const [y1, m1, d1] = from.split('-').map(Number);
    const [y2, m2, d2] = to.split('-').map(Number);
    const a = Date.UTC(y1, m1 - 1, d1);
    const b = Date.UTC(y2, m2 - 1, d2);
    return Math.round((b - a) / 86_400_000);
  }
}
