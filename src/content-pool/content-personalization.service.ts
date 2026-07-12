import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { Goal } from '../goals/entities/goal.entity';
import { Profile } from '../profiles/entities/profile.entity';
import { LessonTemplate } from '../skill-graph/entities/lesson-template.entity';
import { RoleRecipe } from '../skill-graph/entities/role-recipe.entity';
import {
  decodeTimelineWeeks,
  decodeWeeklyHours,
} from '../roadmaps/token-decoders';
import type { LoadedSkillNode, RecipeSubgraph } from '../skill-graph/skill-graph.service';
import {
  CONTENT_SAFETY_FACTOR,
  ContentPublicationStatus,
  SELECTION_WEIGHTS,
} from './content-pool.constants';
import { ContentAnalyticsService } from './content-analytics.service';
import { ContentQueryService } from './content-query.service';

export type SkillGapResult = {
  recipe: RoleRecipe;
  subgraph: RecipeSubgraph;
  requiredSkillIds: string[];
  optionalSkillIds: string[];
  candidateRefreshSkillIds: string[];
  missingPrerequisiteIds: string[];
  knownMappedSkillIds: string[];
  diagnosticRequiredSkillIds: string[];
};

export type ScoredLessonCandidate = {
  template: LessonTemplate;
  skill: LoadedSkillNode;
  score: number;
  required: boolean;
};

export type PersonalizationResult = {
  goalId: string;
  budgetMinutes: number;
  feasibility: 'ok' | 'required_budget_exceeded';
  requiredMinutes: number;
  selected: ScoredLessonCandidate[];
  skippedKnownSkillIds: string[];
  language: string;
  gap: SkillGapResult;
};

const CONFIDENCE_RANK: Record<string, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  expert: 4,
};

@Injectable()
export class ContentPersonalizationService {
  constructor(
    private readonly contentQuery: ContentQueryService,
    private readonly analytics: ContentAnalyticsService,
    @InjectRepository(Goal)
    private readonly goalsRepo: Repository<Goal>,
    @InjectRepository(Profile)
    private readonly profilesRepo: Repository<Profile>,
  ) {}

  async getPersonalizationCandidates(goalId: string): Promise<PersonalizationResult> {
    const goal = await this.goalsRepo.findOne({ where: { id: goalId } });
    if (!goal) {
      throw new AppException(
        AuthErrorCode.GOAL_NOT_FOUND,
        'Goal not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const roles = (goal.targetRoles ?? []).filter(Boolean);
    if (!roles.length) {
      throw new AppException(
        AuthErrorCode.CONTENT_ROLE_RECIPE_MISSING,
        'Goal has no target role',
        HttpStatus.BAD_REQUEST,
      );
    }

    const profile = await this.profilesRepo.findOne({
      where: { userId: goal.userId },
    });
    const language = profile?.language || 'en';

    const recipe = await this.contentQuery.getRoleRecipeForRoles(roles);
    const gap = await this.calculateSkillGap(goal, recipe);
    const styles = goal.learningStyles?.values ?? [];
    const hours = decodeWeeklyHours(goal.weeklyHours);
    const weeks = decodeTimelineWeeks(
      goal.targetDeadline,
      recipe.defaultTimelineWeeks,
    );
    const budget = Math.round(hours * weeks * 60 * CONTENT_SAFETY_FACTOR);

    const candidates = this.scoreCandidates(gap, styles, language);
    const required = candidates.filter((c) => c.required);
    const optional = candidates.filter((c) => !c.required);

    const requiredBySkill = new Map<string, ScoredLessonCandidate>();
    for (const cand of required) {
      const existing = requiredBySkill.get(cand.skill.id);
      if (
        !existing ||
        cand.template.estimatedMinutes < existing.template.estimatedMinutes
      ) {
        requiredBySkill.set(cand.skill.id, cand);
      }
    }
    const requiredReps = [...requiredBySkill.values()];
    const requiredMinutes = requiredReps.reduce(
      (sum, c) => sum + c.template.estimatedMinutes,
      0,
    );

    if (gap.candidateRefreshSkillIds.length) {
      this.analytics.emit('content_skipped_known_skill', {
        goalId: goal.id,
        skillIds: gap.candidateRefreshSkillIds,
        diagnosticRequired: gap.diagnosticRequiredSkillIds,
      });
    }

    if (requiredMinutes > budget) {
      return {
        goalId: goal.id,
        budgetMinutes: budget,
        feasibility: 'required_budget_exceeded',
        requiredMinutes,
        selected: requiredReps,
        skippedKnownSkillIds: gap.candidateRefreshSkillIds,
        language,
        gap,
      };
    }

    const selected: ScoredLessonCandidate[] = [...required];
    let used = required.reduce(
      (sum, c) => sum + c.template.estimatedMinutes,
      0,
    );
    used = Math.min(used, budget);
    for (const cand of optional.sort((a, b) => b.score - a.score)) {
      if (used + cand.template.estimatedMinutes > budget) continue;
      selected.push(cand);
      used += cand.template.estimatedMinutes;
    }

    this.analytics.emit('content_selected_for_roadmap', {
      goalId: goal.id,
      selectedCount: selected.length,
      budgetMinutes: budget,
      language,
    });

    return {
      goalId: goal.id,
      budgetMinutes: budget,
      feasibility: 'ok',
      requiredMinutes,
      selected,
      skippedKnownSkillIds: gap.candidateRefreshSkillIds,
      language,
      gap,
    };
  }

  async calculateSkillGap(goal: Goal, recipe: RoleRecipe): Promise<SkillGapResult> {
    const subgraph = await this.contentQuery.loadSubgraphForRecipe(recipe);
    const allSkills = [...subgraph.skillsByStackSlug.values()].flat();
    const knownTokens = new Set(
      (goal.skills?.values ?? []).filter((s) => s !== 'none'),
    );

    const knownMappedSkillIds: string[] = [];
    const candidateRefreshSkillIds: string[] = [];
    const diagnosticRequiredSkillIds: string[] = [];

    const rules = recipe.minimumAssessmentRules ?? {};
    const requireDiagnostic = rules.requireDiagnosticForSkip !== false;
    const minConf = rules.minConfidenceForSkip ?? 'high';
    const userConf = CONFIDENCE_RANK[goal.confidence ?? 'none'] ?? 0;
    const minConfRank = CONFIDENCE_RANK[minConf] ?? 3;
    const canSkipWithoutDiagnostic =
      userConf >= minConfRank && !requireDiagnostic;

    for (const skill of allSkills) {
      const hit =
        skill.tags.some((t) => knownTokens.has(t)) ||
        knownTokens.has(skill.slug);
      if (!hit) continue;
      knownMappedSkillIds.push(skill.id);
      candidateRefreshSkillIds.push(skill.id);
      if (requireDiagnostic && !canSkipWithoutDiagnostic) {
        diagnosticRequiredSkillIds.push(skill.id);
      }
    }

    let requiredSkillIds = [...(recipe.requiredSkillNodeIds ?? [])];
    let optionalSkillIds = [...(recipe.optionalSkillNodeIds ?? [])];

    if (!requiredSkillIds.length && !optionalSkillIds.length) {
      const requiredSlugs = new Set(
        recipe.stackPlan.phases
          .filter((p) => p.required)
          .flatMap((p) => p.tech_stack_slugs),
      );
      const optionalSlugs = new Set(
        recipe.stackPlan.phases
          .filter((p) => !p.required)
          .flatMap((p) => p.tech_stack_slugs),
      );
      for (const skill of allSkills) {
        const stackSlug = skill.techStack?.slug;
        if (!stackSlug) continue;
        if (requiredSlugs.has(stackSlug)) requiredSkillIds.push(skill.id);
        else if (optionalSlugs.has(stackSlug)) optionalSkillIds.push(skill.id);
      }
    }

    const skillById = new Map(allSkills.map((s) => [s.id, s]));
    const missingPrerequisiteIds = new Set<string>();

    const collectPrereqs = (skillId: string, seen: Set<string>) => {
      if (seen.has(skillId)) return;
      seen.add(skillId);
      const skill = skillById.get(skillId);
      if (!skill) return;
      for (const prereqId of skill.prerequisiteSkillIds ?? []) {
        if (!knownMappedSkillIds.includes(prereqId)) {
          missingPrerequisiteIds.add(prereqId);
        }
        collectPrereqs(prereqId, seen);
      }
    };

    for (const id of requiredSkillIds) {
      collectPrereqs(id, new Set());
    }

    return {
      recipe,
      subgraph,
      requiredSkillIds: [...new Set(requiredSkillIds)],
      optionalSkillIds: [...new Set(optionalSkillIds)],
      candidateRefreshSkillIds,
      missingPrerequisiteIds: [...missingPrerequisiteIds],
      knownMappedSkillIds,
      diagnosticRequiredSkillIds,
    };
  }

  private scoreCandidates(
    gap: SkillGapResult,
    learningStyles: string[],
    language: string,
  ): ScoredLessonCandidate[] {
    const requiredSet = new Set(gap.requiredSkillIds);
    const optionalSet = new Set(gap.optionalSkillIds);
    const refreshSet = new Set(gap.candidateRefreshSkillIds);
    const diagnosticSet = new Set(gap.diagnosticRequiredSkillIds);
    const styleSet = new Set(learningStyles);
    const out: ScoredLessonCandidate[] = [];

    for (const skills of gap.subgraph.skillsByStackSlug.values()) {
      for (const skill of skills) {
        const isRequired =
          requiredSet.has(skill.id) ||
          (requiredSet.size === 0 && !optionalSet.has(skill.id));

        if (
          refreshSet.has(skill.id) &&
          !isRequired &&
          !diagnosticSet.has(skill.id)
        ) {
          continue;
        }

        for (const template of skill.lessonTemplates) {
          if (!this.passesHardFilters(template, language, gap)) continue;

          const roleFit = 1;
          const skillGapFit = refreshSet.has(skill.id) ? 0.35 : 1;
          const prereqReady = gap.missingPrerequisiteIds.includes(skill.id)
            ? 0.4
            : 1;
          const styleOverlap = template.learningStyleTags.filter((t) =>
            styleSet.has(t),
          ).length;
          const learningStyleFit =
            styleSet.size === 0
              ? 0.7
              : Math.min(1, styleOverlap / Math.max(1, styleSet.size));
          const timeFit = template.estimatedMinutes <= 45 ? 1 : 0.7;
          const quality = Number(template.qualityScore ?? 0.7);

          const score =
            roleFit * SELECTION_WEIGHTS.roleFit +
            skillGapFit * SELECTION_WEIGHTS.skillGapFit +
            prereqReady * SELECTION_WEIGHTS.prerequisiteReadiness +
            learningStyleFit * SELECTION_WEIGHTS.learningStyleFit +
            timeFit * SELECTION_WEIGHTS.timeFit +
            quality * SELECTION_WEIGHTS.qualityScore;

          out.push({ template, skill, score, required: isRequired });
        }
      }
    }

    return out.sort((a, b) => b.score - a.score);
  }

  private passesHardFilters(
    template: LessonTemplate,
    language: string,
    gap: SkillGapResult,
  ): boolean {
    if (template.status === ContentPublicationStatus.Blocked) return false;
    if (template.status === ContentPublicationStatus.Retired) return false;
    if (template.language && template.language !== language) {
      if (!(template.language === 'en' && language !== 'en')) {
        if (template.language !== language) return false;
      }
    }
    if (template.defaultResourceId) {
      const resource = gap.subgraph.resourcesById.get(template.defaultResourceId);
      if (!resource || !resource.isActive) return false;
    }
    return template.isActive;
  }

  assertFeasible(result: PersonalizationResult): void {
    if (result.feasibility === 'required_budget_exceeded') {
      throw new AppException(
        AuthErrorCode.CONTENT_REQUIRED_BUDGET_EXCEEDED,
        `Required content ${result.requiredMinutes}m exceeds budget ${result.budgetMinutes}m`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }
}
