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
import { RoadmapPersistenceService } from './roadmap-persistence.service';
import { RoadmapSnapshotService } from './roadmap-snapshot.service';

/**
 * Orchestrates roadmap generation: snapshot → Python engine → persist.
 * Falls back to legacy Nest assembler when ROADMAP_ENGINE_MODE=legacy.
 */
@Injectable()
export class RoadmapGeneratorService {
  private readonly logger = new Logger(RoadmapGeneratorService.name);
  private readonly mode: 'python' | 'legacy';

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
  ) {
    const configured = (config.get<string>('ROADMAP_ENGINE_MODE') ?? 'python')
      .trim()
      .toLowerCase();
    this.mode = configured === 'legacy' ? 'legacy' : 'python';
  }

  async assemble(goalId: string, userId: string): Promise<Roadmap> {
    if (this.mode === 'legacy') {
      this.logger.log(`Assembling via legacy Nest planner goal=${goalId}`);
      return this.legacy.assemble(goalId, userId);
    }
    return this.assembleViaEngine(goalId, userId);
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
    const roadmap = await this.persistence.persistPlan(goal, plan, {
      schemaVersion: 2,
      goalRevision: revision,
      mode: 'python',
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

    try {
      await this.contentQuery.materializeRoadmapContent(roadmap.id, {
        weeks: 3,
        fromWeek: 1,
      });
    } catch (err) {
      this.logger.warn(
        `Materialize window failed for ${roadmap.id}: ${err instanceof Error ? err.message : err}`,
      );
    }

    try {
      await this.timing.bootstrapFromRoadmap(roadmap.id);
    } catch (err) {
      this.logger.warn(
        `Course timing bootstrap failed for ${roadmap.id}: ${err instanceof Error ? err.message : err}`,
      );
    }

    return roadmap;
  }

  private mapErrorCode(code: string): AuthErrorCode {
    const map: Record<string, AuthErrorCode> = {
      ROADMAP_ROLE_NOT_FOUND: AuthErrorCode.ROADMAP_ROLE_NOT_FOUND,
      ROADMAP_GRAPH_INVALID: AuthErrorCode.ROADMAP_GRAPH_INVALID,
      ROADMAP_PREREQUISITE_FAILED: AuthErrorCode.ROADMAP_PREREQUISITE_FAILED,
      ROADMAP_CONTENT_NOT_FOUND: AuthErrorCode.ROADMAP_CONTENT_NOT_FOUND,
      ROADMAP_DEADLINE_UNREALISTIC: AuthErrorCode.ROADMAP_DEADLINE_UNREALISTIC,
      ROADMAP_GENERATION_FAILED: AuthErrorCode.ROADMAP_GENERATION_FAILED,
      ROADMAP_ENGINE_VERSION_CONFLICT:
        AuthErrorCode.ROADMAP_ENGINE_VERSION_CONFLICT,
    };
    return map[code] ?? AuthErrorCode.ROADMAP_GENERATION_FAILED;
  }
}
