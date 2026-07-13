import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { resolveRedisUrl } from '../common/redis/resolve-redis-url';
import { Goal } from '../goals/entities/goal.entity';
import { SkillGraphService } from '../skill-graph/skill-graph.service';
import type {
  ContentSnapshotDto,
  LearnerProfileDto,
} from './dto/roadmap-engine.types';

@Injectable()
export class RoadmapSnapshotService {
  private readonly logger = new Logger(RoadmapSnapshotService.name);
  private redis: Redis | null = null;

  constructor(private readonly skillGraph: SkillGraphService) {
    const url = resolveRedisUrl();
    if (url) {
      try {
        this.redis = new Redis(url, {
          maxRetriesPerRequest: 1,
          lazyConnect: true,
        });
        this.redis.on('error', (err) => {
          this.logger.warn(`Snapshot Redis error: ${err.message}`);
        });
        void this.redis.connect().catch(() => {
          void this.redis?.disconnect();
          this.redis = null;
        });
      } catch {
        this.redis = null;
      }
    }
  }

  goalRevision(goal: Goal): string {
    return `${goal.id}:${goal.updatedAt?.toISOString?.() ?? goal.updatedAt}`;
  }

  seedFor(userId: string, goalRevision: string): number {
    const hex = createHash('sha256')
      .update(`${userId}:${goalRevision}`)
      .digest('hex')
      .slice(0, 8);
    return Number.parseInt(hex, 16);
  }

  toProfile(
    goal: Goal,
    provenMasteredSkillIds: string[] = [],
  ): LearnerProfileDto {
    return {
      user_id: goal.userId,
      goal_id: goal.id,
      goal_revision: this.goalRevision(goal),
      target_roles: this.resolveTargetRoles(goal),
      motivation: goal.motivation?.values ?? [],
      current_profession: goal.currentProfession,
      known_skills: (goal.skills?.values ?? []).filter((s) => s !== 'none'),
      confidence: goal.confidence,
      weekly_hours_token: goal.weeklyHours,
      availability_days: goal.availability?.days ?? [],
      availability_times: goal.availability?.times ?? [],
      target_deadline_token: goal.targetDeadline,
      learning_styles: goal.learningStyles?.values ?? [],
      quit_reasons: goal.quitReasons?.values ?? [],
      language: 'en',
      interview_signals: {},
      proven_mastered_skill_ids: provenMasteredSkillIds,
    };
  }

  /**
   * Prefer column; heal from rawAnswers when target_roles was wiped
   * (e.g. goal stored as string under multi-select normalize).
   */
  resolveTargetRoles(goal: Goal): string[] {
    const fromCol = (goal.targetRoles ?? []).filter(Boolean);
    if (fromCol.length) return fromCol;

    const raw = goal.rawAnswers ?? {};
    const fromRaw: string[] = [];
    const goalVal = raw.goal;
    if (typeof goalVal === 'string' && goalVal.trim()) {
      fromRaw.push(goalVal.trim());
    } else if (Array.isArray(goalVal)) {
      for (const item of goalVal) {
        if (typeof item === 'string' && item.trim()) fromRaw.push(item.trim());
      }
    }
    const other =
      typeof raw.goalOther === 'string' ? raw.goalOther.trim() : '';
    if (other) {
      const slug = other
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
      if (slug) fromRaw.push(slug);
    }
    return [...new Set(fromRaw)];
  }

  /** Throws if roles empty or no active recipe — used before enqueue. */
  async assertHasRecipe(goal: Goal): Promise<string[]> {
    const roles = this.resolveTargetRoles(goal);
    if (!roles.length) {
      throw new Error('No target role on goal — change goal, then rebuild');
    }
    const recipe = await this.skillGraph.findFirstRecipeForRoles(roles);
    if (!recipe) {
      throw new Error(`No role recipe for ${roles.join(', ')}`);
    }
    return roles;
  }

  async buildSnapshot(goal: Goal): Promise<ContentSnapshotDto> {
    const roles = this.resolveTargetRoles(goal);
    const recipe = await this.skillGraph.findFirstRecipeForRoles(roles);
    if (!recipe) {
      throw new Error(
        roles.length
          ? `No role recipe for ${roles.join(', ')}`
          : 'No target role on goal — change goal, then rebuild',
      );
    }

    const cacheKey = `recipe:${recipe.targetRoleSlug}:${recipe.version}`;
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as ContentSnapshotDto;
        }
      } catch (err) {
        this.logger.warn(
          `Snapshot cache read failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    const subgraph = await this.skillGraph.loadSubgraphForRecipe(recipe);
    const skills = [...subgraph.skillsByStackSlug.values()].flat();
    const contentVersion = `recipe-${recipe.id}-v${recipe.version}`;

    const snapshot: ContentSnapshotDto = {
      content_version: contentVersion,
      recipe: {
        id: recipe.id,
        target_role_slug: recipe.targetRoleSlug,
        title: recipe.title,
        default_timeline_weeks: recipe.defaultTimelineWeeks,
        content_version: String(recipe.version),
        required_skill_node_ids: recipe.requiredSkillNodeIds ?? [],
        optional_skill_node_ids: recipe.optionalSkillNodeIds ?? [],
        phase_blueprint: (recipe.stackPlan?.phases ?? []).map((p) => ({
          key: p.key,
          title: p.title,
          tech_stack_slugs: p.tech_stack_slugs ?? [],
          required: p.required,
          include_if_confidence_gte: p.include_if_confidence_gte ?? null,
        })),
        minimum_assessment_rules:
          (recipe.minimumAssessmentRules as Record<string, unknown>) ?? {},
      },
      stacks: [...subgraph.stacksBySlug.values()].map((s) => ({
        id: s.id,
        slug: s.slug,
        title: s.name,
      })),
      skills: skills.map((s) => ({
        id: s.id,
        slug: s.slug,
        title: s.title,
        tech_stack_id: s.techStackId ?? s.techStack?.id ?? null,
        tech_stack_slug: s.techStack?.slug ?? null,
        tags: s.tags ?? [],
        prerequisite_skill_ids: s.prerequisiteSkillIds ?? [],
        estimated_mastery_minutes: 60,
        difficulty: 'beginner',
        order_hint: s.orderHint ?? 0,
        content_version: contentVersion,
      })),
      lessons: skills.flatMap((s) =>
        (s.lessonTemplates ?? []).map((l) => ({
          id: l.id,
          skill_node_id: s.id,
          slug: l.slug,
          title: l.title,
          mission_name_template: l.missionNameTemplate,
          lesson_type: l.lessonType,
          estimated_minutes: l.estimatedMinutes,
          difficulty: l.difficulty,
          xp_reward: l.xpReward,
          reward_class: l.rewardClass ?? 'standard',
          learning_style_tags: l.learningStyleTags ?? [],
          scheduling_tags: l.schedulingTags ?? [],
          language: l.language ?? 'en',
          order_hint: l.orderHint ?? 0,
          default_resource_id: l.defaultResourceId,
          published_version_id: l.publishedVersionId,
          content_outline: (l.contentOutline ?? {}) as Record<string, unknown>,
          status: String(l.status ?? 'published'),
          quality_score: 0.8,
          content_version: contentVersion,
        })),
      ),
      resources: [...subgraph.resourcesById.values()].map((r) => ({
        id: r.id,
        title: r.title,
      })),
      assessments: [],
      projects: [],
    };

    if (this.redis) {
      try {
        await this.redis.set(
          cacheKey,
          JSON.stringify(snapshot),
          'EX',
          60 * 30,
        );
      } catch (err) {
        this.logger.warn(
          `Snapshot cache write failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return snapshot;
  }
}
