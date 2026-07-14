import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { ContentPersonalizationService } from '../content-pool/content-personalization.service';
import { ContentQueryService } from '../content-pool/content-query.service';
import { TimingService } from '../course-timing/timing.service';
import { Goal } from '../goals/entities/goal.entity';
import { LessonTemplate } from '../skill-graph/entities/lesson-template.entity';
import { isPlayOutline } from '../lessons/lesson-play.types';
import {
  LoadedSkillNode,
  RecipeSubgraph,
  SkillGraphService,
} from '../skill-graph/skill-graph.service';
import { Lesson, LessonStatus } from './entities/lesson.entity';
import { Milestone } from './entities/milestone.entity';
import { Roadmap, RoadmapStatus } from './entities/roadmap.entity';
import { RoadmapPhase } from './entities/roadmap-phase.entity';
import { ROADMAP_GENERATOR_PROMPT_VERSION } from './roadmap-ai.prompt';
import { RoadmapAiService } from './roadmap-ai.service';
import type {
  PlannedLesson,
  PlannedMilestone,
  PlannedPhase,
} from './roadmap-plan.types';
import {
  budgetMinutes,
  confidenceMeets,
  decodeTimelineWeeks,
  decodeWeeklyHours,
} from './token-decoders';

const MAX_LESSONS = 80;

/** Legacy Nest-side planner. Used when ROADMAP_ENGINE_MODE=legacy. */
@Injectable()
export class RoadmapLegacyAssembler {
  private readonly logger = new Logger(RoadmapLegacyAssembler.name);

  constructor(
    private readonly skillGraph: SkillGraphService,
    private readonly personalization: ContentPersonalizationService,
    private readonly contentQuery: ContentQueryService,
    private readonly timing: TimingService,
    private readonly dataSource: DataSource,
    private readonly roadmapAi: RoadmapAiService,
    @InjectRepository(Goal)
    private readonly goalsRepo: Repository<Goal>,
  ) {}

  async assemble(goalId: string, userId: string): Promise<Roadmap> {
    const goal = await this.goalsRepo.findOne({ where: { id: goalId } });
    if (!goal || goal.userId !== userId) {
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

    const recipe = await this.skillGraph.findFirstRecipeForRoles(roles);
    if (!recipe) {
      throw new AppException(
        AuthErrorCode.CONTENT_ROLE_RECIPE_MISSING,
        `No role recipe for ${roles.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const personalization =
      await this.personalization.getPersonalizationCandidates(goalId);
    if (personalization.feasibility === 'required_budget_exceeded') {
      this.logger.warn(
        `CONTENT_REQUIRED_BUDGET_EXCEEDED goal=${goalId} required=${personalization.requiredMinutes}m budget=${personalization.budgetMinutes}m`,
      );
    }

    const subgraph = await this.skillGraph.loadSubgraphForRecipe(recipe);
    const hours = decodeWeeklyHours(goal.weeklyHours);
    const weeks = decodeTimelineWeeks(
      goal.targetDeadline,
      recipe.defaultTimelineWeeks,
    );
    const budget = budgetMinutes(hours, weeks);
    const knownSkills = (goal.skills?.values ?? []).filter((s) => s !== 'none');
    const styles = goal.learningStyles?.values ?? [];
    const skippedSkillNodeIds: string[] = [];

    let phases = this.buildPhases(
      subgraph,
      goal.confidence,
      knownSkills,
      styles,
      skippedSkillNodeIds,
    );

    if (!phases.length) {
      throw new AppException(
        AuthErrorCode.CATALOG_EMPTY,
        'Skill graph returned no phases for recipe',
        HttpStatus.BAD_REQUEST,
      );
    }

    phases = this.sizeToBudget(phases, budget);

    const allowedResourceIds = [
      ...new Set(
        phases
          .flatMap((p) => p.milestones)
          .flatMap((m) => m.lessons)
          .map((l) => l.resourceId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const promptVersion = this.roadmapAi.getPromptVersion();
    let pathTitle = `${recipe.title} Path`;
    let aiUsed = false;
    let aiModel: string | undefined;
    let aiSkippedReason: string | undefined;

    if (this.roadmapAi.isEnabled()) {
      const aiResult = await this.roadmapAi.enrich({
        goal,
        recipeTitle: recipe.title,
        phases,
        allowedResourceIds,
      });
      if (aiResult.enrich !== null) {
        const applied = this.roadmapAi.applyEnrich(phases, aiResult.enrich);
        phases = applied.phases;
        if (applied.pathTitle) pathTitle = applied.pathTitle;
        aiUsed = true;
        aiModel = aiResult.model;
      } else {
        aiSkippedReason = aiResult.reason;
      }
    } else {
      aiSkippedReason = 'LLM_API_KEY unset';
    }

    const roadmap = await this.persist(
      goal,
      pathTitle,
      recipe.title,
      recipe.targetRoleSlug,
      weeks,
      hours,
      phases,
      {
        schemaVersion: 1,
        recipeId: recipe.id,
        decodedHours: hours,
        decodedWeeks: weeks,
        skippedSkillNodeIds,
        promptVersion,
        budgetMinutes: budget,
        aiUsed,
        mode: 'legacy',
        ...(aiModel ? { aiModel } : {}),
        ...(aiSkippedReason ? { aiSkippedReason } : {}),
      },
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

  private buildPhases(
    subgraph: RecipeSubgraph,
    confidence: string | null,
    knownSkills: string[],
    styles: string[],
    skippedSkillNodeIds: string[],
  ): PlannedPhase[] {
    const phases: PlannedPhase[] = [];
    let orderIndex = 0;

    for (const planPhase of subgraph.recipe.stackPlan.phases) {
      if (
        !planPhase.required &&
        !confidenceMeets(confidence, planPhase.include_if_confidence_gte)
      ) {
        continue;
      }

      const stackSlug = planPhase.tech_stack_slugs[0] ?? null;
      const stack = stackSlug
        ? subgraph.stacksBySlug.get(stackSlug)
        : undefined;

      const milestones: PlannedMilestone[] = [];
      const seenSkillIds = new Set<string>();

      for (const slug of planPhase.tech_stack_slugs) {
        const skills = this.topoSort(
          subgraph.skillsByStackSlug.get(slug) ?? [],
        );
        for (const skill of skills) {
          if (seenSkillIds.has(skill.id)) continue;
          seenSkillIds.add(skill.id);

          const tagHit = skill.tags.some((t) => knownSkills.includes(t));
          if (tagHit) {
            skippedSkillNodeIds.push(skill.id);
            const practice =
              skill.lessonTemplates.find((l) => l.lessonType === 'practice') ??
              skill.lessonTemplates[0];
            if (!practice) continue;
            milestones.push({
              skill,
              title: `${skill.title} (refresh)`,
              type: 'skill',
              compress: true,
              lessons: [
                this.planLesson(
                  practice,
                  styles,
                  subgraph,
                  LessonStatus.Locked,
                ),
              ],
            });
            continue;
          }

          const lessons = this.pickLessons(skill.lessonTemplates, styles).map(
            (t) => this.planLesson(t, styles, subgraph, LessonStatus.Locked),
          );
          if (!lessons.length) continue;
          milestones.push({
            skill,
            title: skill.title,
            type: 'skill',
            compress: false,
            lessons,
          });
        }
      }

      if (!milestones.length) continue;

      phases.push({
        key: planPhase.key,
        title: planPhase.title,
        techStackId: stack?.id ?? null,
        techStackSlug: stackSlug,
        orderIndex: orderIndex++,
        locked: orderIndex > 1,
        milestones,
      });
    }

    if (phases[0]) {
      phases[0].locked = false;
      const firstLesson = phases[0].milestones[0]?.lessons[0];
      if (firstLesson) firstLesson.status = LessonStatus.Available;
    }

    return phases;
  }

  private pickLessons(
    templates: LessonTemplate[],
    styles: string[],
  ): LessonTemplate[] {
    const sorted = [...templates].sort((a, b) => {
      const aHit = a.learningStyleTags.some((t) => styles.includes(t)) ? 1 : 0;
      const bHit = b.learningStyleTags.some((t) => styles.includes(t)) ? 1 : 0;
      if (bHit !== aHit) return bHit - aHit;
      return a.orderHint - b.orderHint;
    });

    const picked: LessonTemplate[] = [];
    const practice = sorted.find((t) => t.lessonType === 'practice');
    for (const t of sorted) {
      if (picked.length >= 4) break;
      picked.push(t);
    }
    if (practice && !picked.some((p) => p.id === practice.id)) {
      picked[picked.length - 1] = practice;
    }
    return picked.sort((a, b) => a.orderHint - b.orderHint);
  }

  private planLesson(
    template: LessonTemplate,
    _styles: string[],
    subgraph: RecipeSubgraph,
    status: LessonStatus,
  ): PlannedLesson {
    void _styles;
    const resourceId =
      template.defaultResourceId &&
      subgraph.resourcesById.has(template.defaultResourceId)
        ? template.defaultResourceId
        : null;
    return {
      template,
      title: template.title,
      missionName: template.missionNameTemplate,
      resourceId,
      status,
    };
  }

  private sizeToBudget(phases: PlannedPhase[], budget: number): PlannedPhase[] {
    let total = this.sumMinutes(phases);
    let result = [...phases];

    while (total > budget && result.length > 1) {
      result = result.slice(0, -1);
      total = this.sumMinutes(result);
    }

    while (this.countLessons(result) > MAX_LESSONS && result.length > 1) {
      result = result.slice(0, -1);
    }

    return result.map((p, i) => ({
      ...p,
      orderIndex: i,
      locked: i > 0,
      milestones: p.milestones.map((m, mi) => ({
        ...m,
        lessons: m.lessons.map((l, li) => ({
          ...l,
          status:
            i === 0 && mi === 0 && li === 0
              ? LessonStatus.Available
              : LessonStatus.Locked,
        })),
      })),
    }));
  }

  private sumMinutes(phases: PlannedPhase[]): number {
    return phases.reduce(
      (sum, p) =>
        sum +
        p.milestones.reduce(
          (ms, m) =>
            ms +
            m.lessons.reduce((ls, l) => ls + l.template.estimatedMinutes, 0),
          0,
        ),
      0,
    );
  }

  private countLessons(phases: PlannedPhase[]): number {
    return phases.reduce(
      (n, p) => n + p.milestones.reduce((m, ms) => m + ms.lessons.length, 0),
      0,
    );
  }

  private topoSort(skills: LoadedSkillNode[]): LoadedSkillNode[] {
    const byId = new Map(skills.map((s) => [s.id, s]));
    const visited = new Set<string>();
    const result: LoadedSkillNode[] = [];

    const visit = (skill: LoadedSkillNode) => {
      if (visited.has(skill.id)) return;
      visited.add(skill.id);
      for (const preId of skill.prerequisiteSkillIds ?? []) {
        const pre = byId.get(preId);
        if (pre) visit(pre);
      }
      result.push(skill);
    };

    const ordered = [...skills].sort((a, b) => a.orderHint - b.orderHint);
    for (const skill of ordered) visit(skill);
    return result;
  }

  private async persist(
    goal: Goal,
    pathTitle: string,
    recipeTitle: string,
    primaryRole: string,
    weeks: number,
    hours: number,
    phases: PlannedPhase[],
    meta: Record<string, unknown>,
  ): Promise<Roadmap> {
    return this.dataSource.transaction(async (manager) => {
      await manager.update(
        Roadmap,
        { goalId: goal.id, status: RoadmapStatus.Ready },
        { status: RoadmapStatus.Archived },
      );

      const roadmap = await manager.save(
        manager.create(Roadmap, {
          userId: goal.userId,
          goalId: goal.id,
          title: pathTitle,
          description: `Personalized path for ${recipeTitle}`,
          primaryRoleSlug: primaryRole,
          timelineWeeks: weeks,
          weeklyHoursTarget: String(hours),
          status: RoadmapStatus.Ready,
          progressPercent: '0',
          generatedByPromptVersion:
            (meta.promptVersion as string) || ROADMAP_GENERATOR_PROMPT_VERSION,
          generationMeta: meta,
        }),
      );

      let firstPhaseId: string | null = null;

      for (const planned of phases) {
        const phase = await manager.save(
          manager.create(RoadmapPhase, {
            roadmapId: roadmap.id,
            techStackId: planned.techStackId,
            techStackSlug: planned.techStackSlug,
            title: planned.title,
            orderIndex: planned.orderIndex,
            locked: planned.locked,
          }),
        );
        if (firstPhaseId === null) firstPhaseId = phase.id;

        for (let mi = 0; mi < planned.milestones.length; mi++) {
          const pm = planned.milestones[mi]!;
          const milestone = await manager.save(
            manager.create(Milestone, {
              phaseId: phase.id,
              skillNodeId: pm.skill.id,
              title: pm.title,
              type: pm.type,
              orderIndex: mi,
              xpReward: pm.compress ? 25 : 50,
            }),
          );

          for (let li = 0; li < pm.lessons.length; li++) {
            const pl = pm.lessons[li]!;
            const outline = isPlayOutline(pl.template.contentOutline)
              ? pl.template.contentOutline
              : null;
            await manager.save(
              manager.create(Lesson, {
                milestoneId: milestone.id,
                lessonTemplateId: pl.template.id,
                title: pl.title,
                missionName: pl.missionName,
                lessonType: pl.template.lessonType,
                estimatedMinutes: pl.template.estimatedMinutes,
                difficulty: pl.template.difficulty,
                xpReward: pl.template.xpReward,
                orderIndex: li,
                resourceId: pl.resourceId,
                status: pl.status,
                playContent: outline,
                sourceVersionId: pl.template.publishedVersionId ?? null,
                rewardClassSnapshot: pl.template.rewardClass ?? 'standard',
                materializedWindow: null,
                objective:
                  outline &&
                  typeof outline === 'object' &&
                  'objective' in outline
                    ? String((outline as { objective: string }).objective)
                    : null,
              }),
            );
          }
        }
      }

      roadmap.currentPhaseId = firstPhaseId;
      return manager.save(roadmap);
    });
  }
}
