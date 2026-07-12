import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { Profile } from '../profiles/entities/profile.entity';
import {
  RewardCurrency,
  RewardLedgerEntry,
  RewardReasonType,
} from './entities/reward-ledger-entry.entity';
import { Wallet } from './entities/wallet.entity';

export type GrantLine = {
  currency: RewardCurrency;
  amount: number;
  idempotencySuffix: string;
};

export type GrantRewardInput = {
  userId: string;
  reasonType: RewardReasonType;
  reasonId: string;
  lines: GrantLine[];
  /** Shared prefix; each line appends `:${currency}:${suffix}`. */
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  transactionGroupId?: string;
};

export type GrantRewardResult = {
  transactionGroupId: string;
  wallet: {
    lifetimeXp: number;
    weeklyLeagueXp: number;
    gems: number;
    coins: number;
    version: number;
  };
  entryIds: Partial<Record<RewardCurrency, string>>;
  alreadyGranted: boolean;
};

@Injectable()
export class RewardLedgerService {
  constructor(private readonly dataSource: DataSource) {}

  async grantReward(
    manager: EntityManager,
    input: GrantRewardInput,
  ): Promise<GrantRewardResult> {
    const ledgerRepo = manager.getRepository(RewardLedgerEntry);
    const groupId = input.transactionGroupId ?? randomUUID();

    const probeKey = `${input.idempotencyKey}:probe`;
    const existingProbe = await ledgerRepo.findOne({
      where: {
        userId: input.userId,
        idempotencyKey: `${input.idempotencyKey}:${RewardCurrency.LifetimeXp}:xp`,
      },
    });

    // Prefer exact line lookup for idempotency.
    const firstLine = input.lines.find((l) => l.amount !== 0);
    if (firstLine) {
      const firstKey = this.lineKey(
        input.idempotencyKey,
        firstLine.currency,
        firstLine.idempotencySuffix,
      );
      const existing = await ledgerRepo.findOne({
        where: { userId: input.userId, idempotencyKey: firstKey },
      });
      if (existing) {
        const wallet = await this.ensureWallet(manager, input.userId);
        return {
          transactionGroupId: existing.transactionGroupId,
          wallet: this.snapshot(wallet),
          entryIds: { [existing.currency]: existing.id },
          alreadyGranted: true,
        };
      }
    } else if (existingProbe) {
      const wallet = await this.ensureWallet(manager, input.userId);
      return {
        transactionGroupId: existingProbe.transactionGroupId,
        wallet: this.snapshot(wallet),
        entryIds: {},
        alreadyGranted: true,
      };
    }

    const wallet = await this.ensureWallet(manager, input.userId, true);
    const entryIds: Partial<Record<RewardCurrency, string>> = {};

    for (const line of input.lines) {
      if (line.amount === 0) continue;
      const key = this.lineKey(
        input.idempotencyKey,
        line.currency,
        line.idempotencySuffix,
      );
      const dup = await ledgerRepo.findOne({
        where: { userId: input.userId, idempotencyKey: key },
      });
      if (dup) {
        entryIds[line.currency] = dup.id;
        continue;
      }

      const entry = await ledgerRepo.save(
        ledgerRepo.create({
          userId: input.userId,
          currency: line.currency,
          amount: line.amount,
          reasonType: input.reasonType,
          reasonId: input.reasonId,
          transactionGroupId: groupId,
          idempotencyKey: key,
          metadata: input.metadata ?? {},
        }),
      );
      entryIds[line.currency] = entry.id;
      this.applyLine(wallet, line.currency, line.amount);
    }

    // Zero-reward completions still leave a probe so replay is idempotent.
    if (input.lines.every((l) => l.amount === 0)) {
      const key = `${input.idempotencyKey}:probe`;
      const dup = await ledgerRepo.findOne({
        where: { userId: input.userId, idempotencyKey: key },
      });
      if (!dup) {
        await ledgerRepo.save(
          ledgerRepo.create({
            userId: input.userId,
            currency: RewardCurrency.LifetimeXp,
            amount: 0,
            reasonType: input.reasonType,
            reasonId: input.reasonId,
            transactionGroupId: groupId,
            idempotencyKey: key,
            metadata: { ...(input.metadata ?? {}), probe: true },
          }),
        );
      }
    }

    wallet.version += 1;
    await manager.getRepository(Wallet).save(wallet);
    await this.mirrorProfile(manager, input.userId, wallet);

    void probeKey;

    return {
      transactionGroupId: groupId,
      wallet: this.snapshot(wallet),
      entryIds,
      alreadyGranted: false,
    };
  }

  async findByIdempotencyPrefix(
    manager: EntityManager,
    userId: string,
    idempotencyKeyBase: string,
  ): Promise<RewardLedgerEntry | null> {
    const repo = manager.getRepository(RewardLedgerEntry);
    return repo
      .createQueryBuilder('e')
      .where('e.user_id = :userId', { userId })
      .andWhere('e.idempotency_key LIKE :key', {
        key: `${idempotencyKeyBase}%`,
      })
      .orderBy('e.created_at', 'ASC')
      .getOne();
  }

  async listLedger(
    userId: string,
    opts?: { cursor?: string; limit?: number },
  ): Promise<{
    entries: Array<{
      id: string;
      currency: RewardCurrency;
      amount: number;
      reasonType: RewardReasonType;
      reasonId: string | null;
      transactionGroupId: string;
      metadata: Record<string, unknown>;
      createdAt: Date;
    }>;
    nextCursor: string | null;
  }> {
    const limit = Math.min(100, Math.max(1, opts?.limit ?? 30));
    const repo = this.dataSource.getRepository(RewardLedgerEntry);
    const qb = repo
      .createQueryBuilder('e')
      .where('e.user_id = :userId', { userId })
      .orderBy('e.created_at', 'DESC')
      .addOrderBy('e.id', 'DESC')
      .take(limit + 1);

    if (opts?.cursor) {
      const cursor = await repo.findOne({ where: { id: opts.cursor } });
      if (cursor) {
        qb.andWhere(
          '(e.created_at < :cAt OR (e.created_at = :cAt AND e.id < :cId))',
          { cAt: cursor.createdAt, cId: cursor.id },
        );
      }
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    return {
      entries: slice.map((e) => ({
        id: e.id,
        currency: e.currency,
        amount: e.amount,
        reasonType: e.reasonType,
        reasonId: e.reasonId,
        transactionGroupId: e.transactionGroupId,
        metadata: e.metadata,
        createdAt: e.createdAt,
      })),
      nextCursor: hasMore ? slice[slice.length - 1].id : null,
    };
  }

  async getTransactionGroup(userId: string, transactionGroupId: string) {
    const rows = await this.dataSource.getRepository(RewardLedgerEntry).find({
      where: { userId, transactionGroupId },
      order: { createdAt: 'ASC' },
    });
    if (!rows.length) return null;
    return {
      transactionGroupId,
      reasonType: rows[0].reasonType,
      reasonId: rows[0].reasonId,
      createdAt: rows[0].createdAt,
      lines: rows.map((e) => ({
        id: e.id,
        currency: e.currency,
        amount: e.amount,
        metadata: e.metadata,
      })),
    };
  }

  async ensureWallet(
    manager: EntityManager,
    userId: string,
    forUpdate = false,
  ): Promise<Wallet> {
    const repo = manager.getRepository(Wallet);
    let wallet = forUpdate
      ? await repo.findOne({
          where: { userId },
          lock: { mode: 'pessimistic_write' },
        })
      : await repo.findOne({ where: { userId } });

    if (wallet) return wallet;

    const profile = await manager
      .getRepository(Profile)
      .findOne({ where: { userId } });

    wallet = repo.create({
      userId,
      lifetimeXp: profile?.totalXp ?? 0,
      weeklyLeagueXp: 0,
      gems: profile?.gems ?? 0,
      coins: profile?.coins ?? 0,
    });
    return repo.save(wallet);
  }

  private applyLine(
    wallet: Wallet,
    currency: RewardCurrency,
    amount: number,
  ): void {
    switch (currency) {
      case RewardCurrency.LifetimeXp:
        wallet.lifetimeXp += amount;
        break;
      case RewardCurrency.LeagueXp:
        wallet.weeklyLeagueXp += amount;
        break;
      case RewardCurrency.Gems:
        wallet.gems += amount;
        break;
      case RewardCurrency.Coins:
        wallet.coins += amount;
        break;
    }
  }

  private async mirrorProfile(
    manager: EntityManager,
    userId: string,
    wallet: Wallet,
  ): Promise<void> {
    const profileRepo = manager.getRepository(Profile);
    const profile = await profileRepo.findOne({ where: { userId } });
    if (!profile) return;
    profile.totalXp = wallet.lifetimeXp;
    profile.gems = wallet.gems;
    profile.coins = wallet.coins;
    await profileRepo.save(profile);
  }

  private lineKey(
    base: string,
    currency: RewardCurrency,
    suffix: string,
  ): string {
    return `${base}:${currency}:${suffix}`.slice(0, 128);
  }

  private snapshot(wallet: Wallet) {
    return {
      lifetimeXp: wallet.lifetimeXp,
      weeklyLeagueXp: wallet.weeklyLeagueXp,
      gems: wallet.gems,
      coins: wallet.coins,
      version: wallet.version,
    };
  }
}
