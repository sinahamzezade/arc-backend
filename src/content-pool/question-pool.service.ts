import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { BattleCatalogService } from './battle-catalog.service';
import { BATTLE_POOL_MIN_MULTIPLIER } from './content-pool.constants';
import { ContentAnalyticsService } from './content-analytics.service';
import { Unit } from './entities/unit.entity';
import {
  flattenQuizUnitsToPool,
  skillIdMatchesTaught,
  topicMatchesSkills,
  type UnitBattlePoolItem,
} from './unit-battle-question.util';

export type BattleQuestionSelectInput = {
  subject?: string;
  topic?: string;
  skillNodeId?: string;
  difficultyMix?: string[];
  count: number;
  /** Hint for pacing (defaults 30). */
  secondsPerQuestion?: number;
  userExposureHistory?: string[];
  opponentExposureHistory?: string[];
  mode: 'live' | 'async';
  userId?: string;
};

export type BattleQuestionSnapshot = {
  questionTemplateId: string;
  questionVersionId: string;
  version: number;
  questionType: string;
  difficulty: string;
  difficultyScore: number;
  estimatedSeconds: number;
  prompt: Record<string, unknown>;
  options: Array<{ id: string; label: string }>;
  /** Server-only grading keys — never in toPlayPayload. */
  correctOptionIds: string[];
  explanation: string;
  /** Calibration twin key for async mode (same difficulty band). */
  calibrationKey: string;
};

export type BattleQuestionSet = {
  mode: 'live' | 'async';
  questions: BattleQuestionSnapshot[];
  /** Identical for live; paired equivalents for async. */
  sharedVersionIds: string[];
};

@Injectable()
export class QuestionPoolService {
  constructor(
    @InjectRepository(Unit)
    private readonly unitsRepo: Repository<Unit>,
    private readonly analytics: ContentAnalyticsService,
    private readonly battleCatalog: BattleCatalogService,
  ) {}

  /**
   * Select battle questions from active quiz units (flattened content.questions).
   */
  async selectBattleSet(
    input: BattleQuestionSelectInput,
  ): Promise<BattleQuestionSet> {
    const resolved = await this.resolveCatalogIds(input);
    return this.selectFromUnits({ ...input, ...resolved });
  }

  /**
   * Create-invite preflight against quiz-unit pool after catalog resolve.
   */
  async canFulfillBattleSet(input: BattleQuestionSelectInput): Promise<boolean> {
    const resolved = await this.resolveCatalogIds(input);
    try {
      await this.selectFromUnits({ ...input, ...resolved });
      return true;
    } catch {
      return false;
    }
  }

  private async resolveCatalogIds(
    input: BattleQuestionSelectInput,
  ): Promise<
    Pick<BattleQuestionSelectInput, 'subject' | 'skillNodeId' | 'topic'>
  > {
    const stackSlug =
      (await this.battleCatalog.resolveSubjectSlug(input.subject ?? '')) ??
      input.subject?.trim().toLowerCase().replace(/\s+/g, '-');
    if (!stackSlug) return {};

    let skillNodeId = input.skillNodeId;
    if (!skillNodeId && input.topic) {
      const skill = await this.battleCatalog.resolveSkill(
        stackSlug,
        input.topic,
      );
      if (skill) {
        const n = await this.battleCatalog.publishedBattleCountForSkill(
          skill.id,
        );
        if (n > 0) skillNodeId = skill.id;
      }
    } else if (skillNodeId) {
      const n =
        await this.battleCatalog.publishedBattleCountForSkill(skillNodeId);
      if (n === 0) skillNodeId = undefined;
    }

    return {
      subject: stackSlug,
      ...(skillNodeId ? { skillNodeId } : {}),
      ...(input.topic && !skillNodeId ? { topic: input.topic } : {}),
    };
  }

  private async selectFromUnits(
    input: BattleQuestionSelectInput,
  ): Promise<BattleQuestionSet> {
    const pool = await this.loadEligiblePoolItems(input);
    const minPool = input.count * BATTLE_POOL_MIN_MULTIPLIER;
    if (pool.length < minPool) {
      throw new AppException(
        AuthErrorCode.CONTENT_QUESTION_POOL_TOO_SMALL,
        `Battle pool need ≥${minPool} quiz-unit questions, have ${pool.length}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const exposed = new Set([
      ...(input.userExposureHistory ?? []),
      ...(input.opponentExposureHistory ?? []),
    ]);

    let eligible = pool.filter((p) => !exposed.has(p.questionVersionId));
    if (eligible.length < input.count) {
      eligible = pool;
    }

    if (eligible.length < input.count) {
      throw new AppException(
        AuthErrorCode.CONTENT_QUESTION_POOL_TOO_SMALL,
        `Need ${input.count} battle questions, have ${eligible.length}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const difficultyMix = input.difficultyMix ?? [];
    let snapshots = this.pickWithDifficultyMix(
      eligible,
      input.count,
      difficultyMix,
    );

    if (input.mode === 'async') {
      snapshots = this.differentiateAsyncSet(snapshots, pool);
    }

    this.analytics.emit('battle_question_set_created', {
      mode: input.mode,
      count: snapshots.length,
      subject: input.subject ?? null,
      source: 'units',
    });

    return {
      mode: input.mode,
      questions: snapshots.map(this.toPublicSnapshot),
      sharedVersionIds: snapshots.map((q) => q.questionVersionId),
    };
  }

  private toPublicSnapshot(item: UnitBattlePoolItem): BattleQuestionSnapshot {
    const {
      unitId: _u,
      questionIndex: _i,
      stack: _s,
      skillsTaught: _sk,
      ...snap
    } = item;
    return snap;
  }

  /**
   * Async: shuffle order + swap ~half with same-calibration twins when available
   * so answer leakage across delayed play is harder.
   */
  private differentiateAsyncSet(
    snapshots: UnitBattlePoolItem[],
    allPool: UnitBattlePoolItem[],
  ): UnitBattlePoolItem[] {
    const used = new Set(snapshots.map((s) => s.questionVersionId));
    const out = snapshots.map((snap, i) => {
      if (i % 2 === 1) return snap;
      const twin = allPool.find((v) => {
        if (used.has(v.questionVersionId)) return false;
        return (
          v.calibrationKey === snap.calibrationKey &&
          v.questionVersionId !== snap.questionVersionId
        );
      });
      if (!twin) return snap;
      used.add(twin.questionVersionId);
      return twin;
    });
    return [...out].sort(() => Math.random() - 0.5);
  }

  /** Play payload strip — never includes answer keys. */
  toPlayPayload(snapshot: BattleQuestionSnapshot) {
    return {
      questionVersionId: snapshot.questionVersionId,
      questionType: snapshot.questionType,
      difficulty: snapshot.difficulty,
      estimatedSeconds: snapshot.estimatedSeconds,
      prompt: snapshot.prompt,
      options: snapshot.options,
    };
  }

  private async loadEligiblePoolItems(
    input: BattleQuestionSelectInput,
  ): Promise<UnitBattlePoolItem[]> {
    const qb = this.unitsRepo
      .createQueryBuilder('u')
      .where('u.is_active = true')
      .andWhere('u.lesson_type = :lt', { lt: 'quiz' });

    if (input.subject) {
      qb.andWhere('u.stack = :stack', { stack: input.subject });
    }

    const units = await qb.getMany();
    let pool = flattenQuizUnitsToPool(units, input.secondsPerQuestion);

    if (input.skillNodeId) {
      pool = pool.filter((p) =>
        skillIdMatchesTaught(p.skillsTaught, input.skillNodeId),
      );
    } else if (input.topic) {
      pool = pool.filter((p) => topicMatchesSkills(p.skillsTaught, input.topic));
    }

    return pool;
  }

  private pickWithDifficultyMix(
    items: UnitBattlePoolItem[],
    count: number,
    difficultyMix: string[],
  ): UnitBattlePoolItem[] {
    const shuffled = [...items].sort(() => Math.random() - 0.5);
    if (!difficultyMix.length) {
      return shuffled.slice(0, count);
    }

    const picked: UnitBattlePoolItem[] = [];
    const used = new Set<string>();
    for (const difficulty of difficultyMix) {
      if (picked.length >= count) break;
      const match = shuffled.find((v) => {
        if (used.has(v.questionVersionId)) return false;
        return v.difficulty === difficulty;
      });
      if (match) {
        picked.push(match);
        used.add(match.questionVersionId);
      }
    }

    for (const v of shuffled) {
      if (picked.length >= count) break;
      if (used.has(v.questionVersionId)) continue;
      picked.push(v);
      used.add(v.questionVersionId);
    }

    return picked;
  }
}
