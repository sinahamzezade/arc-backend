import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { resolveRedisUrl } from '../common/redis/resolve-redis-url';
import { Goal, GoalStatus } from '../goals/entities/goal.entity';
import { RoadmapEngineClient } from '../roadmaps/roadmap-engine.client';
import { RoadmapSnapshotService } from '../roadmaps/roadmap-snapshot.service';

export type EngineHealthView = {
  reachable: boolean;
  status: string;
  engineVersion: number | null;
  nestExpectedVersion: number;
  baseUrl: string;
  mode: string;
  latencyMs: number | null;
  error: string | null;
};

export type GoalOption = {
  id: string;
  userId: string;
  roles: string;
  label: string;
};

@Injectable()
export class AdminRoadmapEngineService {
  constructor(
    private readonly config: ConfigService,
    private readonly engine: RoadmapEngineClient,
    private readonly snapshot: RoadmapSnapshotService,
    @InjectRepository(Goal)
    private readonly goalsRepo: Repository<Goal>,
  ) {}

  configSummary() {
    return {
      baseUrl: (
        this.config.get<string>('ROADMAP_ENGINE_URL') ?? 'http://localhost:8080'
      ).replace(/\/$/, ''),
      mode: (
        this.config.get<string>('ROADMAP_ENGINE_MODE') ?? 'llm'
      ).toLowerCase(),
      nestExpectedVersion: Number(
        this.config.get('ROADMAP_ENGINE_VERSION') ?? 2,
      ),
      timeoutMs: Number(
        this.config.get('ROADMAP_GENERATION_TIMEOUT_MS') ?? 45_000,
      ),
      redisConfigured: Boolean(resolveRedisUrl(this.config.get<string>('REDIS_URL'))),
    };
  }

  async checkHealth(): Promise<EngineHealthView> {
    const cfg = this.configSummary();
    const started = Date.now();
    try {
      const health = await this.engine.health();
      return {
        reachable: true,
        status: health.status ?? 'ok',
        engineVersion: health.engineVersion ?? null,
        nestExpectedVersion: cfg.nestExpectedVersion,
        baseUrl: cfg.baseUrl,
        mode: cfg.mode,
        latencyMs: Date.now() - started,
        error: null,
      };
    } catch (err) {
      return {
        reachable: false,
        status: 'unreachable',
        engineVersion: null,
        nestExpectedVersion: cfg.nestExpectedVersion,
        baseUrl: cfg.baseUrl,
        mode: cfg.mode,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async listRecentGoals(limit = 40): Promise<GoalOption[]> {
    const rows = await this.goalsRepo.find({
      where: { status: GoalStatus.Active },
      order: { updatedAt: 'DESC' },
      take: limit,
    });
    return rows.map((g) => {
      const roles = (g.targetRoles ?? []).filter(Boolean).join(', ') || '—';
      return {
        id: g.id,
        userId: g.userId,
        roles,
        label: `${g.id.slice(0, 8)}… · ${roles}`,
      };
    });
  }

  /**
   * Dry-run: snapshot + Python /v1/plan. Does not persist a roadmap.
   */
  async dryRunPlan(goalId: string): Promise<{
    ok: boolean;
    error: string | null;
    summary: Record<string, unknown> | null;
    rawJson: string;
  }> {
    const goal = await this.goalsRepo.findOne({ where: { id: goalId } });
    if (!goal) {
      return {
        ok: false,
        error: 'Goal not found',
        summary: null,
        rawJson: '',
      };
    }

    try {
      const contentSnapshot = await this.snapshot.buildSnapshot(goal);
      const profile = this.snapshot.toProfile(goal);
      const revision = this.snapshot.goalRevision(goal);
      const seed = this.snapshot.seedFor(goal.userId, revision);
      const response = await this.engine.plan(profile, contentSnapshot, seed);

      const plan = response.plan;
      const summary = {
        ok: response.ok,
        errorCode: response.error_code,
        errorMessage: response.error_message,
        feasibility: response.feasibility,
        seed,
        goalRevision: revision,
        recipe: contentSnapshot.recipe.target_role_slug,
        title: plan?.title ?? null,
        engineVersion: plan?.engine_version ?? null,
        contentVersion: plan?.content_version ?? null,
        timelineWeeks: plan?.timeline_weeks ?? null,
        estimatedWeeks: plan?.estimated_weeks ?? null,
        weeklyHours: plan?.weekly_hours_target ?? null,
        phaseCount: plan?.phases?.length ?? 0,
        learningPhaseCount:
          plan?.phases?.filter((p) => p.week_type === 'learning').length ?? 0,
        lessonCount:
          plan?.phases?.reduce(
            (n, p) =>
              n + p.milestones.reduce((m, ms) => m + ms.lessons.length, 0),
            0,
          ) ?? 0,
        skippedKnown: plan?.skipped_known ?? [],
        explanationCount: plan?.explanations?.length ?? 0,
        sampleExplanations: (plan?.explanations ?? []).slice(0, 5),
        phaseTitles: (plan?.phases ?? []).map((p) => ({
          key: p.key,
          title: p.title,
          weekType: p.week_type,
          milestones: p.milestones.length,
        })),
      };

      return {
        ok: Boolean(response.ok),
        error: response.ok
          ? null
          : response.error_message || response.error_code || 'Plan failed',
        summary,
        rawJson: JSON.stringify(response, null, 2),
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        summary: null,
        rawJson: '',
      };
    }
  }
}
