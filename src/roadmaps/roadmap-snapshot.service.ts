import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { JsonCacheService } from '../common/cache/json-cache.service';
import { Goal } from '../goals/entities/goal.entity';
import type { LearnerProfileSnapshot } from '../questionnaire/entities/learner-profile-snapshot.entity';
import { SkillGraphService } from '../skill-graph/skill-graph.service';
import type {
  ContentSnapshotDto,
  LearnerProfileDto,
} from './dto/roadmap-engine.types';

@Injectable()
export class RoadmapSnapshotService {
  private readonly logger = new Logger(RoadmapSnapshotService.name);

  constructor(
    private readonly skillGraph: SkillGraphService,
    private readonly cache: JsonCacheService,
  ) {}

  private snapshotKey(roleSlug: string, version: number): string {
    return `content:recipe:${roleSlug}:v${version}`;
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
    profileSnapshot?: LearnerProfileSnapshot | null,
  ): LearnerProfileDto {
    const base: LearnerProfileDto = {
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
    if (!profileSnapshot) return base;

    return {
      ...base,
      skill_estimates: (profileSnapshot.skillEstimates ?? []).map((e) => ({
        skill_slug: e.skillSlug,
        self_exposure_level: e.selfExposureLevel,
        provisional_stage: e.provisionalStage,
        verified_stage: e.verifiedStage,
        confidence: e.confidence,
        diagnostic_required:
          profileSnapshot.diagnosticRequired && e.verifiedStage == null,
      })),
      current_stage:
        profileSnapshot.verifiedStage ?? profileSnapshot.provisionalStage,
      target_stage: profileSnapshot.targetStage,
      weekly_effective_minutes: profileSnapshot.weeklyEffectiveMinutes,
      learning_style_weights: profileSnapshot.learningStyleWeights ?? {},
      pace_class: profileSnapshot.paceClass,
    };
  }

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
    const other = typeof raw.goalOther === 'string' ? raw.goalOther.trim() : '';
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

    const cacheKey = this.snapshotKey(recipe.targetRoleSlug, recipe.version);
    const cached = await this.cache.getJson<ContentSnapshotDto>(cacheKey);
    if (cached) {
      return cached;
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

    await this.cache.setJson(cacheKey, snapshot, 30 * 60);
    return snapshot;
  }

  async invalidateRecipeCaches(roleSlugs?: string[]): Promise<void> {
    try {
      if (roleSlugs?.length) {
        for (const slug of roleSlugs) {
          await this.cache.delByPrefix(`content:recipe:${slug}:`);
        }
        this.logger.log(
          `Invalidated recipe snapshot(s) for ${roleSlugs.join(',')}`,
        );
        return;
      }
      const removed = await this.cache.delByPrefix('content:recipe:');
      this.logger.log(`Invalidated ${removed} recipe snapshot(s)`);
    } catch (err) {
      this.logger.warn(
        `Recipe cache invalidate failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
