import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import { resolveRedisUrl } from '../common/redis/resolve-redis-url';
import { LIVE_MEMBER_KEY, LIVE_SCORE_KEY } from './leagues.constants';

type MemberMeta = {
  userId: string;
  qualifiedXp: number;
  updatedAt: string;
};

/**
 * Live cohort scores — Redis sorted sets when REDIS_URL set, else in-memory.
 * PostgreSQL remains authoritative; this is a best-effort projection.
 */
@Injectable()
export class LeagueLiveScoresService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LeagueLiveScoresService.name);
  private redis: Redis | null = null;
  private readonly memScores = new Map<string, Map<string, number>>();
  private readonly memMembers = new Map<string, MemberMeta>();

  onModuleInit() {
    const url = resolveRedisUrl();
    if (!url) {
      this.logger.log('League live scores: in-memory (set REDIS_URL for Redis)');
      return;
    }
    try {
      this.redis = new Redis(url, {
        maxRetriesPerRequest: 2,
        enableReadyCheck: true,
        lazyConnect: true,
      });
      this.redis.on('error', (err) => {
        this.logger.warn(`League Redis error: ${err.message}`);
      });
      void this.redis.connect().then(
        () => this.logger.log('League live scores: Redis connected'),
        (err: Error) => {
          this.logger.warn(`Redis connect failed, using memory: ${err.message}`);
          void this.redis?.disconnect();
          this.redis = null;
        },
      );
    } catch (err) {
      this.logger.warn(
        `Redis init failed: ${err instanceof Error ? err.message : err}`,
      );
      this.redis = null;
    }
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit().catch(() => undefined);
      this.redis = null;
    }
  }

  get backend(): 'redis' | 'memory' {
    return this.redis ? 'redis' : 'memory';
  }

  async setScore(
    cohortId: string,
    userId: string,
    qualifiedXp: number,
  ): Promise<void> {
    const key = LIVE_SCORE_KEY(cohortId);
    const memberKey = LIVE_MEMBER_KEY(cohortId, userId);
    const meta: MemberMeta = {
      userId,
      qualifiedXp,
      updatedAt: new Date().toISOString(),
    };

    if (this.redis) {
      try {
        await this.redis.zadd(key, qualifiedXp, userId);
        await this.redis.set(memberKey, JSON.stringify(meta), 'EX', 60 * 60 * 24 * 10);
        return;
      } catch (err) {
        this.logger.warn(
          `Redis setScore failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    let set = this.memScores.get(key);
    if (!set) {
      set = new Map();
      this.memScores.set(key, set);
    }
    set.set(userId, qualifiedXp);
    this.memMembers.set(memberKey, meta);
  }

  async getLeaderboard(
    cohortId: string,
    limit = 30,
  ): Promise<Array<{ userId: string; score: number }>> {
    const key = LIVE_SCORE_KEY(cohortId);

    if (this.redis) {
      try {
        const rows = await this.redis.zrevrange(key, 0, limit - 1, 'WITHSCORES');
        const out: Array<{ userId: string; score: number }> = [];
        for (let i = 0; i < rows.length; i += 2) {
          out.push({ userId: rows[i], score: Number(rows[i + 1]) });
        }
        return out;
      } catch (err) {
        this.logger.warn(
          `Redis getLeaderboard failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    const set = this.memScores.get(key);
    if (!set) return [];
    return [...set.entries()]
      .map(([userId, score]) => ({ userId, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async getScore(cohortId: string, userId: string): Promise<number | null> {
    if (this.redis) {
      try {
        const score = await this.redis.zscore(LIVE_SCORE_KEY(cohortId), userId);
        return score == null ? null : Number(score);
      } catch {
        /* fall through */
      }
    }
    const set = this.memScores.get(LIVE_SCORE_KEY(cohortId));
    if (!set || !set.has(userId)) return null;
    return set.get(userId)!;
  }

  async reconcile(
    cohortId: string,
    rows: Array<{ userId: string; qualifiedXp: number }>,
  ): Promise<void> {
    const key = LIVE_SCORE_KEY(cohortId);

    if (this.redis) {
      try {
        const pipeline = this.redis.pipeline();
        pipeline.del(key);
        for (const row of rows) {
          pipeline.zadd(key, row.qualifiedXp, row.userId);
          pipeline.set(
            LIVE_MEMBER_KEY(cohortId, row.userId),
            JSON.stringify({
              userId: row.userId,
              qualifiedXp: row.qualifiedXp,
              updatedAt: new Date().toISOString(),
            }),
            'EX',
            60 * 60 * 24 * 10,
          );
        }
        await pipeline.exec();
        this.logger.debug(
          `Redis reconciled cohort=${cohortId} members=${rows.length}`,
        );
        return;
      } catch (err) {
        this.logger.warn(
          `Redis reconcile failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    const set = new Map<string, number>();
    for (const row of rows) {
      set.set(row.userId, row.qualifiedXp);
      this.memMembers.set(LIVE_MEMBER_KEY(cohortId, row.userId), {
        userId: row.userId,
        qualifiedXp: row.qualifiedXp,
        updatedAt: new Date().toISOString(),
      });
    }
    this.memScores.set(key, set);
    this.logger.debug(
      `Memory reconciled cohort=${cohortId} members=${rows.length}`,
    );
  }

  async clearCohort(cohortId: string): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.del(LIVE_SCORE_KEY(cohortId));
        return;
      } catch {
        /* fall through */
      }
    }
    this.memScores.delete(LIVE_SCORE_KEY(cohortId));
  }

  /** Publish lightweight cohort bump for SSE clients (Redis pub/sub when available). */
  async publishCohortUpdate(cohortId: string, payload: Record<string, unknown>) {
    if (!this.redis) return;
    try {
      await this.redis.publish(
        `league:cohort:${cohortId}:updates`,
        JSON.stringify({ cohortId, ...payload, at: new Date().toISOString() }),
      );
    } catch {
      /* ignore */
    }
  }
}
