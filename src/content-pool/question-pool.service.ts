import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { BattleCatalogService } from './battle-catalog.service';
import { BattleQuestionLlmService } from './battle-question-llm.service';
import {
  BATTLE_POOL_MIN_MULTIPLIER,
  ContentPublicationStatus,
} from './content-pool.constants';
import { ContentAnalyticsService } from './content-analytics.service';
import { QuestionTemplate } from './entities/question-template.entity';
import { QuestionVersion } from './entities/question-version.entity';
import { resolveQuestionAnswer } from './question-answer.util';

export type BattleQuestionSelectInput = {
  subject?: string;
  topic?: string;
  skillNodeId?: string;
  difficultyMix?: string[];
  count: number;
  /** Hint for LLM stem length / pacing (defaults 30). */
  secondsPerQuestion?: number;
  userExposureHistory?: string[];
  opponentExposureHistory?: string[];
  mode: 'live' | 'async';
  /** Bill AI tokens to this user (usually challenger). */
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
  private readonly logger = new Logger(QuestionPoolService.name);

  constructor(
    @InjectRepository(QuestionTemplate)
    private readonly questionsRepo: Repository<QuestionTemplate>,
    @InjectRepository(QuestionVersion)
    private readonly versionsRepo: Repository<QuestionVersion>,
    private readonly analytics: ContentAnalyticsService,
    private readonly battleLlm: BattleQuestionLlmService,
    private readonly battleCatalog: BattleCatalogService,
  ) {}

  /**
   * Prefer LLM (catalog-grounded) when configured; fall back to seeded pool.
   */
  async selectBattleSet(
    input: BattleQuestionSelectInput,
  ): Promise<BattleQuestionSet> {
    const resolved = await this.resolveCatalogIds(input);
    const withCatalog = { ...input, ...resolved };

    if (this.battleLlm.isConfigured()) {
      const llmSet = await this.battleLlm.generateBattleSet(withCatalog);
      if (llmSet?.questions.length) {
        this.analytics.emit('battle_question_set_created', {
          mode: input.mode,
          count: llmSet.questions.length,
          subject: input.subject ?? null,
          source: 'llm',
        });
        return llmSet;
      }
      this.logger.warn('Battle LLM empty — falling back to seeded pool');
    }

    return this.selectFromSeededPool(withCatalog);
  }

  /**
   * Create-invite preflight against seeded pool after catalog resolve.
   * Empty skill-graph stacks must fail here (not only on accept).
   */
  async canFulfillBattleSet(input: BattleQuestionSelectInput): Promise<boolean> {
    const resolved = await this.resolveCatalogIds(input);
    try {
      await this.selectFromSeededPool({ ...input, ...resolved });
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

    // Only pin skillNodeId when that skill actually has battle content.
    // Seeded pool uses tech_stack_slug + slug topic — skill filter would yield 0.
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
      // Keep topic for slug ILIKE when not skill-bound.
      ...(input.topic && !skillNodeId ? { topic: input.topic } : {}),
    };
  }

  private async selectFromSeededPool(
    input: BattleQuestionSelectInput,
  ): Promise<BattleQuestionSet> {
    const templates = await this.loadEligibleTemplates(input);
    const publishedIds = templates
      .map((t) => t.publishedVersionId)
      .filter((id): id is string => Boolean(id));

    const minPool = input.count * BATTLE_POOL_MIN_MULTIPLIER;
    if (publishedIds.length < minPool) {
      throw new AppException(
        AuthErrorCode.CONTENT_QUESTION_POOL_TOO_SMALL,
        `Battle pool need ≥${minPool} published versions, have ${publishedIds.length}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const versions = await this.versionsRepo.find({
      where: {
        id: In(publishedIds),
        status: ContentPublicationStatus.Published,
      },
    });

    const exposed = new Set([
      ...(input.userExposureHistory ?? []),
      ...(input.opponentExposureHistory ?? []),
    ]);

    const byTemplate = new Map(templates.map((t) => [t.id, t]));
    let eligible = versions.filter((v) => !exposed.has(v.id));
    if (eligible.length < input.count) {
      // Fall back to full published set if exposure wiped the pool.
      eligible = versions;
    }

    if (eligible.length < input.count) {
      throw new AppException(
        AuthErrorCode.CONTENT_QUESTION_POOL_TOO_SMALL,
        `Need ${input.count} battle questions, have ${eligible.length}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const difficultyMix = input.difficultyMix ?? [];
    const picked = this.pickWithDifficultyMix(
      eligible,
      byTemplate,
      input.count,
      difficultyMix,
    );

    let snapshots = picked.map((v) =>
      this.toSnapshot(v, byTemplate.get(v.questionTemplateId)!),
    );

    if (input.mode === 'async') {
      snapshots = this.differentiateAsyncSet(snapshots, versions, byTemplate);
    }

    this.analytics.emit('battle_question_set_created', {
      mode: input.mode,
      count: snapshots.length,
      subject: input.subject ?? null,
      source: 'pool',
    });

    return {
      mode: input.mode,
      questions: snapshots,
      sharedVersionIds: snapshots.map((q) => q.questionVersionId),
    };
  }

  /**
   * Async: shuffle order + swap ~half with same-calibration twins when available
   * so answer leakage across delayed play is harder.
   */
  private differentiateAsyncSet(
    snapshots: BattleQuestionSnapshot[],
    allVersions: QuestionVersion[],
    byTemplate: Map<string, QuestionTemplate>,
  ): BattleQuestionSnapshot[] {
    const used = new Set(snapshots.map((s) => s.questionVersionId));
    const out = snapshots.map((snap, i) => {
      if (i % 2 === 1) return snap;
      const twin = allVersions.find((v) => {
        if (used.has(v.id)) return false;
        const t = byTemplate.get(v.questionTemplateId);
        if (!t) return false;
        const key = `${t.difficulty}:${Number(t.difficultyScore).toFixed(1)}`;
        return key === snap.calibrationKey && v.id !== snap.questionVersionId;
      });
      if (!twin) return snap;
      used.add(twin.id);
      return this.toSnapshot(twin, byTemplate.get(twin.questionTemplateId)!);
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

  private async loadEligibleTemplates(input: BattleQuestionSelectInput) {
    const qb = this.questionsRepo
      .createQueryBuilder('q')
      .where('q.is_active = true')
      .andWhere('q.status = :status', {
        status: ContentPublicationStatus.Published,
      })
      .andWhere(`:ctx = ANY(q.allowed_contexts)`, { ctx: 'battle' });

    if (input.skillNodeId) {
      qb.andWhere('q.skill_node_id = :skillNodeId', {
        skillNodeId: input.skillNodeId,
      });
    }
    if (input.subject) {
      qb.andWhere('q.tech_stack_slug = :subject', { subject: input.subject });
    }
    // Topic slug match only when not already pinned to a skill node.
    if (input.topic && !input.skillNodeId) {
      const topicRaw = input.topic.trim();
      const topicSlug = topicRaw.toLowerCase().replace(/\s+/g, '-');
      qb.andWhere('(q.slug ILIKE :topicRaw OR q.slug ILIKE :topicSlug)', {
        topicRaw: `%${topicRaw}%`,
        topicSlug: `%${topicSlug}%`,
      });
    }

    return qb.getMany();
  }

  private pickWithDifficultyMix(
    versions: QuestionVersion[],
    templates: Map<string, QuestionTemplate>,
    count: number,
    difficultyMix: string[],
  ): QuestionVersion[] {
    const shuffled = [...versions].sort(() => Math.random() - 0.5);
    if (!difficultyMix.length) {
      return shuffled.slice(0, count);
    }

    const picked: QuestionVersion[] = [];
    const used = new Set<string>();
    for (const difficulty of difficultyMix) {
      if (picked.length >= count) break;
      const match = shuffled.find((v) => {
        if (used.has(v.id)) return false;
        return templates.get(v.questionTemplateId)?.difficulty === difficulty;
      });
      if (match) {
        picked.push(match);
        used.add(match.id);
      }
    }

    for (const v of shuffled) {
      if (picked.length >= count) break;
      if (used.has(v.id)) continue;
      picked.push(v);
      used.add(v.id);
    }

    return picked;
  }

  private toSnapshot(
    version: QuestionVersion,
    template: QuestionTemplate,
  ): BattleQuestionSnapshot {
    const answer = resolveQuestionAnswer(version);
    return {
      questionTemplateId: template.id,
      questionVersionId: version.id,
      version: version.version,
      questionType: template.questionType,
      difficulty: template.difficulty,
      difficultyScore: Number(template.difficultyScore),
      estimatedSeconds: template.estimatedSeconds,
      prompt: version.prompt as Record<string, unknown>,
      options: (answer.options ?? []).map((o) => ({ id: o.id, label: o.label })),
      correctOptionIds: answer.correctOptionIds ?? [],
      explanation: version.explanation || answer.explanation || '',
      calibrationKey: `${template.difficulty}:${Number(template.difficultyScore).toFixed(1)}`,
    };
  }
}
