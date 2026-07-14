import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { ContentQueryService } from '../content-pool/content-query.service';
import { TimingService } from '../course-timing/timing.service';
import { Goal } from '../goals/entities/goal.entity';
import { Roadmap } from './entities/roadmap.entity';
import { RoadmapAnalyticsService } from './roadmap-analytics.service';
import { RoadmapEngineClient } from './roadmap-engine.client';
import { RoadmapLegacyAssembler } from './roadmap-legacy.assembler';
import { RoadmapLlmPlannerService } from './roadmap-llm-planner.service';
import { RoadmapPersistenceService } from './roadmap-persistence.service';
import { RoadmapSnapshotService } from './roadmap-snapshot.service';
import { RoadmapAiService } from './roadmap-ai.service';
import { SystemFlagsService } from '../system-flags/system-flags.service';
import {
  ROADMAP_ENGINE_MODES,
  SystemFlagKey,
  type RoadmapEngineMode,
} from '../system-flags/system-flag.keys';

/**
 * Orchestrates roadmap generation.
 * Modes: llm (default) | python | legacy
 * llm = GLM/OpenAI-compatible planner from intake chat + goal answers.
 */
@Injectable()
export class RoadmapGeneratorService {
  private readonly logger = new Logger(RoadmapGeneratorService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Goal)
    private readonly goalsRepo: Repository<Goal>,
    private readonly snapshot: RoadmapSnapshotService,
    private readonly engine: RoadmapEngineClient,
    private readonly persistence: RoadmapPersistenceService,
    private readonly analytics: RoadmapAnalyticsService,
    private readonly contentQuery: ContentQueryService,
    private readonly timing: TimingService,
    private readonly legacy: RoadmapLegacyAssembler,
    private readonly roadmapAi: RoadmapAiService,
    private readonly llmPlanner: RoadmapLlmPlannerService,
    private readonly systemFlags: SystemFlagsService,
  ) {}

  private async resolveMode(userId?: string | null): Promise<RoadmapEngineMode> {
    const configured = (
      await this.systemFlags.getString(
        SystemFlagKey.ROADMAP_ENGINE_MODE,
        this.config.get<string>('ROADMAP_ENGINE_MODE') ?? 'llm',
        userId,
      )
    )
      .trim()
      .toLowerCase();
    if ((ROADMAP_ENGINE_MODES as readonly string[]).includes(configured)) {
      return configured as RoadmapEngineMode;
    }
    return 'llm';
  }

  async assemble(goalId: string, userId: string): Promise<Roadmap> {
    const mode = await this.resolveMode(userId);
    this.logger.log(
      `[roadmap-gen] assemble start goal=${goalId} user=${userId} engineMode=${mode}`,
    );
    if (mode === 'legacy') {
      this.logger.log(
        `[roadmap-gen] path=legacy (Nest assembler, no LLM planner)`,
      );
      return this.legacy.assemble(goalId, userId);
    }
    if (mode === 'python') {
      this.logger.log(
        `[roadmap-gen] path=python (roadmap-engine HTTP; LLM titles optional)`,
      );
      return this.assembleViaEngine(goalId, userId);
    }
    this.logger.log(
      `[roadmap-gen] path=llm (LLM planner owns phase/lesson picks)`,
    );
    return this.assembleViaLlm(goalId, userId);
  }

  private async assembleViaLlm(
    goalId: string,
    userId: string,
  ): Promise<Roadmap> {
    const goal = await this.goalsRepo.findOne({ where: { id: goalId } });
    if (!goal || goal.userId !== userId) {
      throw new AppException(
        AuthErrorCode.GOAL_NOT_FOUND,
        'Goal not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const revision = this.snapshot.goalRevision(goal);
    const seed = this.snapshot.seedFor(userId, revision);
    this.logger.log(
      `[roadmap-gen] llm snapshot goal=${goalId} revision=${revision} seed=${seed}`,
    );

    let contentSnapshot;
    try {
      contentSnapshot = await this.snapshot.buildSnapshot(goal);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[roadmap-gen] llm snapshot failed goal=${goalId}: ${message}`,
      );
      this.analytics.roadmapGenerationFailed({
        goalRevision: revision,
        code: AuthErrorCode.ROADMAP_ROLE_NOT_FOUND,
        stage: 'snapshot',
      });
      throw new AppException(
        AuthErrorCode.CONTENT_ROLE_RECIPE_MISSING,
        message,
        HttpStatus.BAD_REQUEST,
      );
    }

    this.logger.log(
      `[roadmap-gen] llm snapshot ok recipe=${contentSnapshot.recipe.title} lessons=${contentSnapshot.lessons.length}`,
    );

    const profile = this.snapshot.toProfile(goal);

    let planResult;
    try {
      this.logger.log(`[roadmap-gen] llm planner call start goal=${goalId}`);
      planResult = await this.llmPlanner.plan({
        goal,
        profile,
        snapshot: contentSnapshot,
        seed,
      });
    } catch (err) {
      this.logger.error(
        `[roadmap-gen] llm planner hard-fail goal=${goalId}: ${err instanceof Error ? err.message : err}`,
      );
      this.analytics.roadmapGenerationFailed({
        goalRevision: revision,
        code: AuthErrorCode.ROADMAP_GENERATION_FAILED,
        stage: 'llm_plan',
      });
      throw new AppException(
        AuthErrorCode.ROADMAP_GENERATION_FAILED,
        err instanceof Error ? err.message : 'LLM roadmap plan failed',
        HttpStatus.BAD_GATEWAY,
      );
    }

    this.logger.log(
      `[roadmap-gen] llm planner done model=${planResult.model} prompt=${planResult.promptVersion} fallback=${planResult.usedFallback} weeks=${planResult.plan.estimated_weeks} phases=${planResult.plan.phases.length}`,
    );

    const roadmap = await this.persistence.persistPlan(goal, planResult.plan, {
      schemaVersion: 2,
      goalRevision: revision,
      mode: 'llm',
      aiEnrich: true,
      aiModel: planResult.model,
      aiMode: 'planner',
      aiPromptVersion: planResult.promptVersion,
      aiUsedFallback: planResult.usedFallback,
    });

    this.analytics.roadmapGenerated({
      roadmapId: roadmap.id,
      goalRevision: revision,
      engineVersion: planResult.plan.engine_version,
      estimatedWeeks: planResult.plan.estimated_weeks,
      phaseCount: planResult.plan.phases.filter(
        (p) => p.week_type === 'learning',
      ).length,
    });

    this.logger.log(
      `[roadmap-gen] llm persist ok roadmap=${roadmap.id} model=${planResult.model} fallback=${planResult.usedFallback}`,
    );

    await this.postPersist(roadmap.id);
    return roadmap;
  }

  private async assembleViaEngine(
    goalId: string,
    userId: string,
  ): Promise<Roadmap> {
    const goal = await this.goalsRepo.findOne({ where: { id: goalId } });
    if (!goal || goal.userId !== userId) {
      throw new AppException(
        AuthErrorCode.GOAL_NOT_FOUND,
        'Goal not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const revision = this.snapshot.goalRevision(goal);
    const seed = this.snapshot.seedFor(userId, revision);

    let contentSnapshot;
    try {
      contentSnapshot = await this.snapshot.buildSnapshot(goal);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.analytics.roadmapGenerationFailed({
        goalRevision: revision,
        code: AuthErrorCode.ROADMAP_ROLE_NOT_FOUND,
        stage: 'snapshot',
      });
      throw new AppException(
        AuthErrorCode.CONTENT_ROLE_RECIPE_MISSING,
        message,
        HttpStatus.BAD_REQUEST,
      );
    }

    this.logger.log(
      `[roadmap-gen] python engine call start goal=${goalId} revision=${revision}`,
    );
    const profile = this.snapshot.toProfile(goal);
    let response;
    try {
      response = await this.engine.plan(profile, contentSnapshot, seed);
    } catch (err) {
      this.logger.error(
        `[roadmap-gen] python engine hard-fail: ${err instanceof Error ? err.message : err}`,
      );
      this.analytics.roadmapGenerationFailed({
        goalRevision: revision,
        code: AuthErrorCode.ROADMAP_GENERATION_FAILED,
        stage: 'engine_call',
      });
      throw new AppException(
        AuthErrorCode.ROADMAP_GENERATION_FAILED,
        err instanceof Error ? err.message : 'Engine call failed',
        HttpStatus.BAD_GATEWAY,
      );
    }

    if (!response.ok || !response.plan) {
      const code =
        response.error_code ?? AuthErrorCode.ROADMAP_GENERATION_FAILED;
      if (code === 'ROADMAP_DEADLINE_UNREALISTIC') {
        this.analytics.roadmapFeasibilityReturned({
          goalRevision: revision,
          earliestRealisticDate:
            response.feasibility?.earliest_realistic_date ?? null,
        });
      }
      this.analytics.roadmapGenerationFailed({
        goalRevision: revision,
        code,
        stage: 'plan',
      });
      throw new AppException(
        this.mapErrorCode(code),
        response.error_message ?? 'Roadmap generation failed',
        HttpStatus.BAD_REQUEST,
      );
    }

    const plan = response.plan;
    let enrichedPlan = plan;
    let enrichMeta: Record<string, unknown> = {};

    if (this.roadmapAi.isEnabled()) {
      const titleResult = await this.roadmapAi.enrichPlanTitles({
        goal,
        recipeTitle: contentSnapshot.recipe.title,
        plan,
      });
      if (titleResult.enrich !== null) {
        enrichedPlan = this.roadmapAi.applyPlanTitleEnrich(
          plan,
          titleResult.enrich,
        );
        enrichMeta = {
          aiEnrich: true,
          aiModel: titleResult.model,
          aiMode: 'titles',
        };
      } else {
        enrichMeta = {
          aiEnrich: false,
          aiSkippedReason: titleResult.reason,
        };
      }
    } else {
      enrichMeta = { aiEnrich: false, aiSkippedReason: 'LLM_API_KEY unset' };
    }

    const roadmap = await this.persistence.persistPlan(goal, enrichedPlan, {
      schemaVersion: 2,
      goalRevision: revision,
      mode: 'python',
      ...enrichMeta,
    });

    this.analytics.roadmapGenerated({
      roadmapId: roadmap.id,
      goalRevision: revision,
      engineVersion: plan.engine_version,
      estimatedWeeks: plan.estimated_weeks,
      phaseCount: plan.phases.filter((p) => p.week_type === 'learning').length,
    });

    this.logger.log(
      `Assembled roadmap ${roadmap.id} via python engine (seed=${plan.seed})`,
    );

    await this.postPersist(roadmap.id);
    return roadmap;
  }

  private async postPersist(roadmapId: string) {
    try {
      await this.contentQuery.materializeRoadmapContent(roadmapId, {
        weeks: 3,
        fromWeek: 1,
      });
    } catch (err) {
      this.logger.warn(
        `Materialize window failed for ${roadmapId}: ${err instanceof Error ? err.message : err}`,
      );
    }

    try {
      await this.timing.bootstrapFromRoadmap(roadmapId);
    } catch (err) {
      this.logger.warn(
        `Course timing bootstrap failed for ${roadmapId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private mapErrorCode(code: string): AuthErrorCode {
    const map: Record<string, AuthErrorCode> = {
      ROADMAP_ROLE_NOT_FOUND: AuthErrorCode.ROADMAP_ROLE_NOT_FOUND,
      ROADMAP_GRAPH_INVALID: AuthErrorCode.ROADMAP_GRAPH_INVALID,
      ROADMAP_DEADLINE_UNREALISTIC: AuthErrorCode.ROADMAP_DEADLINE_UNREALISTIC,
      ROADMAP_CONTENT_NOT_FOUND: AuthErrorCode.ROADMAP_CONTENT_NOT_FOUND,
      ROADMAP_PREREQUISITE_FAILED: AuthErrorCode.ROADMAP_PREREQUISITE_FAILED,
    };
    return map[code] ?? AuthErrorCode.ROADMAP_GENERATION_FAILED;
  }
}
