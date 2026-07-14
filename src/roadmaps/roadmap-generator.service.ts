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
    this.logger.log(`assemble goal=${goalId} mode=${mode}`);
    if (mode === 'legacy') {
      this.logger.log(`Assembling via legacy Nest planner goal=${goalId}`);
      return this.legacy.assemble(goalId, userId);
    }
    if (mode === 'python') {
      return this.assembleViaEngine(goalId, userId);
    }
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

    const profile = this.snapshot.toProfile(goal);

    let planResult;
    try {
      planResult = await this.llmPlanner.plan({
        goal,
        profile,
        snapshot: contentSnapshot,
        seed,
      });
    } catch (err) {
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
      `Assembled roadmap ${roadmap.id} via LLM planner (model=${planResult.model}, fallback=${planResult.usedFallback})`,
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

    const profile = this.snapshot.toProfile(goal);
    let response;
    try {
      response = await this.engine.plan(profile, contentSnapshot, seed);
    } catch (err) {
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
