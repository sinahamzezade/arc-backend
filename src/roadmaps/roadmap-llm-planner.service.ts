import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LlmService } from '../common/llm/llm.service';
import { CourseTemplate } from '../content-pool/entities/course-template.entity';
import { ModuleTemplate } from '../content-pool/entities/module-template.entity';
import { Goal } from '../goals/entities/goal.entity';
import { QuestionnaireResponse } from '../questionnaire/entities/questionnaire-response.entity';
import type {
  ContentSnapshotDto,
  LearnerProfileDto,
  RoadmapPlanDto,
  SelectedLessonDto,
  SelectedMilestoneDto,
  SelectedPhaseDto,
} from './dto/roadmap-engine.types';
import {
  buildCompactUserPacket,
  buildRoadmapLlmPlannerSystemPrompt,
  buildRoadmapLlmPlannerUserPrompt,
  ROADMAP_LLM_PLANNER_PROMPT_VERSION,
  type CompactCourse,
  type CompactLesson,
  type LlmPlannerDraft,
} from './roadmap-llm-planner.prompt';
import { parseLlmPlannerDraft } from './roadmap-llm-planner.schema';
import {
  budgetMinutes,
  decodeTimelineWeeks,
  decodeWeeklyHours,
} from './token-decoders';

export type LlmPlanResult = {
  plan: RoadmapPlanDto;
  model: string;
  promptVersion: string;
  usedFallback: boolean;
};

type RelatedCatalog = {
  lessons: CompactLesson[];
  courses: CompactCourse[];
  /** index → lesson template id */
  lessonIdByIndex: Map<number, string>;
  lessonById: Map<string, ContentSnapshotDto['lessons'][number]>;
};

@Injectable()
export class RoadmapLlmPlannerService {
  private readonly logger = new Logger(RoadmapLlmPlannerService.name);

  constructor(
    private readonly llm: LlmService,
    @InjectRepository(QuestionnaireResponse)
    private readonly responsesRepo: Repository<QuestionnaireResponse>,
    @InjectRepository(CourseTemplate)
    private readonly coursesRepo: Repository<CourseTemplate>,
    @InjectRepository(ModuleTemplate)
    private readonly modulesRepo: Repository<ModuleTemplate>,
  ) {}

  getPromptVersion(): string {
    return ROADMAP_LLM_PLANNER_PROMPT_VERSION;
  }

  async plan(input: {
    goal: Goal;
    profile: LearnerProfileDto;
    snapshot: ContentSnapshotDto;
    seed: number;
  }): Promise<LlmPlanResult> {
    const hours = decodeWeeklyHours(input.goal.weeklyHours);
    const weeks = decodeTimelineWeeks(
      input.goal.targetDeadline,
      input.snapshot.recipe.default_timeline_weeks,
    );
    const transcript = await this.loadChatTranscript(input.goal.userId);
    const rawAnswers =
      (input.goal.rawAnswers as Record<string, unknown> | null) ?? {};

    const catalog = await this.buildRelatedCatalog(
      input.snapshot,
      input.profile,
      input.seed,
    );
    const user = buildCompactUserPacket({
      profile: {
        target_roles: input.profile.target_roles,
        known_skills: input.profile.known_skills,
        learning_styles: input.profile.learning_styles,
        confidence: input.profile.confidence,
        current_profession: input.profile.current_profession,
        motivation: input.profile.motivation,
      },
      rawAnswers,
      chatTranscript: transcript,
      hours,
      weeks,
      seed: input.seed,
    });

    const draft = await this.callLlmDraft({
      userId: input.goal.userId,
      user,
      catalog,
      recipeTitle: input.snapshot.recipe.title,
      roleSlug: input.snapshot.recipe.target_role_slug,
    });

    let usedFallback = false;
    let model = draft?.model ?? 'fallback';
    let parsed = draft?.draft ?? null;

    if (!parsed) {
      usedFallback = true;
      parsed = this.deterministicDraft(catalog, user.skills, input.seed);
      this.logger.warn('LLM planner soft-fail — catalog fallback draft');
    }

    const plan = this.hydratePlan({
      draft: parsed,
      snapshot: input.snapshot,
      catalog,
      seed: input.seed,
      hours,
      weeks,
    });

    return {
      plan,
      model,
      promptVersion: this.getPromptVersion(),
      usedFallback,
    };
  }

  private async loadChatTranscript(
    userId: string,
  ): Promise<Array<{ role: string; content: string }>> {
    try {
      const row = await this.responsesRepo.findOne({ where: { userId } });
      return row?.chatTranscript ?? [];
    } catch (err) {
      this.logger.warn(
        `Chat transcript load failed: ${err instanceof Error ? err.message : err}`,
      );
      return [];
    }
  }

  /**
   * Related catalog = recipe lessons (+ content-pool courses).
   * Indices are seed-shuffled so LLM cannot lazily emit 0,1,2… catalog order.
   */
  private async buildRelatedCatalog(
    snapshot: ContentSnapshotDto,
    profile: LearnerProfileDto,
    seed: number,
  ): Promise<RelatedCatalog> {
    const known = new Set(
      (profile.known_skills ?? []).map((s) => s.toLowerCase()),
    );
    const styles = new Set(
      (profile.learning_styles ?? []).map((s) => s.toLowerCase()),
    );
    const skillById = new Map(snapshot.skills.map((s) => [s.id, s]));

    const scored = snapshot.lessons.map((lesson) => {
      const skill = skillById.get(lesson.skill_node_id);
      const hay =
        `${skill?.slug ?? ''} ${skill?.title ?? ''} ${lesson.title} ${(skill?.tags ?? []).join(' ')}`.toLowerCase();
      const knownHit = [...known].some(
        (k) => k && (hay.includes(k) || k.includes(skill?.slug ?? '')),
      );
      let score = lesson.quality_score || 0.5;
      score += Math.max(0, 8 - (lesson.order_hint || 0) * 0.1);
      if (knownHit) score -= 8;
      for (const tag of lesson.learning_style_tags ?? []) {
        if (styles.has(tag.toLowerCase())) score += 3;
      }
      return { lesson, skill, score, knownHit };
    });

    const unknown = scored.filter((s) => !s.knownHit).slice(0, 48);
    const knownLessons = scored.filter((s) => s.knownHit).slice(0, 8);
    // Seed shuffle so displayed index ≠ fixed catalog order
    const picked = this.seedShuffle(
      [...unknown, ...knownLessons].slice(0, 56),
      seed,
    );

    const lessonIdByIndex = new Map<number, string>();
    const lessonById = new Map<string, ContentSnapshotDto['lessons'][number]>();
    const lessons: CompactLesson[] = [];

    for (let i = 0; i < picked.length; i++) {
      const row = picked[i]!;
      lessonIdByIndex.set(i, row.lesson.id);
      lessonById.set(row.lesson.id, row.lesson);
      lessons.push({
        n: i,
        t: row.lesson.title.slice(0, 48),
        m: row.lesson.estimated_minutes || 20,
        sk: (row.skill?.slug ?? 'skill').slice(0, 24),
        st: (row.lesson.learning_style_tags ?? []).slice(0, 3),
        d: (row.lesson.difficulty || 'beginner').slice(0, 12),
      });
    }

    const allowedLessonIds = new Set(
      lessons.map((_, i) => lessonIdByIndex.get(i)!),
    );
    const courses = await this.loadRelatedCourses(
      snapshot,
      allowedLessonIds,
      lessonIdByIndex,
    );

    return { lessons, courses, lessonIdByIndex, lessonById };
  }

  private seedShuffle<T>(items: T[], seed: number): T[] {
    const arr = [...items];
    let s = seed >>> 0 || 1;
    for (let i = arr.length - 1; i > 0; i--) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const j = s % (i + 1);
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr;
  }

  private async loadRelatedCourses(
    snapshot: ContentSnapshotDto,
    allowedLessonIds: Set<string>,
    lessonIdByIndex: Map<number, string>,
  ): Promise<CompactCourse[]> {
    const indexByLessonId = new Map(
      [...lessonIdByIndex.entries()].map(([n, id]) => [id, n]),
    );
    const stackSlugs = new Set(snapshot.stacks.map((s) => s.slug));

    try {
      const all = await this.coursesRepo.find({
        where: { isActive: true },
        order: { title: 'ASC' },
        take: 40,
      });
      const related = all.filter((c) => {
        if (c.techStackSlugs?.some((s) => stackSlugs.has(s))) return true;
        const titleHay = `${c.slug} ${c.title}`.toLowerCase();
        const role = snapshot.recipe.target_role_slug.toLowerCase();
        return role && titleHay.includes(role.split('-')[0] ?? '');
      });

      const courseIds = related.slice(0, 12).map((c) => c.id);
      if (!courseIds.length) return [];

      const modules = await this.modulesRepo.find({
        where: { courseTemplateId: In(courseIds), isActive: true },
        order: { orderHint: 'ASC' },
      });

      const lessonsByCourse = new Map<string, string[]>();
      for (const mod of modules) {
        const list = lessonsByCourse.get(mod.courseTemplateId) ?? [];
        for (const lid of mod.lessonTemplateIds ?? []) {
          if (allowedLessonIds.has(lid) && !list.includes(lid)) list.push(lid);
        }
        lessonsByCourse.set(mod.courseTemplateId, list);
      }

      const courses: CompactCourse[] = [];
      let n = 0;
      for (const course of related.slice(0, 12)) {
        const lids = lessonsByCourse.get(course.id) ?? [];
        const indices = lids
          .map((id) => indexByLessonId.get(id))
          .filter((i): i is number => i !== undefined)
          .slice(0, 16);
        if (!indices.length) continue;
        courses.push({
          n,
          t: course.title.slice(0, 48),
          lessons: indices,
        });
        n += 1;
        if (courses.length >= 8) break;
      }
      return courses;
    } catch (err) {
      this.logger.warn(
        `Related courses load failed: ${err instanceof Error ? err.message : err}`,
      );
      return [];
    }
  }

  private async callLlmDraft(input: {
    userId: string;
    user: ReturnType<typeof buildCompactUserPacket>;
    catalog: RelatedCatalog;
    recipeTitle: string;
    roleSlug: string;
  }): Promise<{ draft: LlmPlannerDraft; model: string } | null> {
    if (!this.llm.isConfigured()) {
      this.logger.warn('LLM planner skipped — client not configured');
      return null;
    }
    if (!input.catalog.lessons.length) return null;

    const model = await this.llm.getModel('enrich');
    const system = buildRoadmapLlmPlannerSystemPrompt();
    const baseUser = buildRoadmapLlmPlannerUserPrompt({
      user: input.user,
      courses: input.catalog.courses,
      lessons: input.catalog.lessons,
      recipeTitle: input.recipeTitle,
      roleSlug: input.roleSlug,
    });

    const attempts: Array<{ user: string; temperature: number }> = [
      { user: baseUser, temperature: 0.6 },
      {
        user: `${baseUser}\nREDO: prior pick looked like catalog order. Return a NON-SEQUENTIAL subset ordered for u.skills/u.styles/u.chat.`,
        temperature: 0.85,
      },
    ];

    let lastModel = model;
    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i]!;
      try {
        const completion = await this.llm.chatCompletion({
          purpose: 'enrich',
          userId: input.userId,
          request: {
            model,
            temperature: attempt.temperature,
            max_tokens: 1400,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: attempt.user },
            ],
          },
        });
        const content = completion.choices[0]?.message?.content;
        if (!content) continue;
        lastModel =
          typeof completion.model === 'string' && completion.model
            ? completion.model
            : model;
        const draft = parseLlmPlannerDraft(
          JSON.parse(content),
          input.catalog.lessonIdByIndex,
        );
        const flat = draft.phases.flatMap((p) => p.lesson_ids);
        if (flat.length < 4) {
          this.logger.warn(
            `LLM draft too small (${flat.length} lessons) attempt=${i + 1}`,
          );
          continue;
        }
        if (this.isNearCatalogOrder(draft, input.catalog) && i === 0) {
          this.logger.warn(
            'LLM draft near catalog order — retrying with stronger reorder hint',
          );
          continue;
        }
        this.logger.log(
          `LLM draft ok lessons=${flat.length} phases=${draft.phases.length} attempt=${i + 1}`,
        );
        return { draft, model: lastModel };
      } catch (err) {
        this.logger.warn(
          `LLM roadmap plan attempt ${i + 1} failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return null;
  }

  private isNearCatalogOrder(
    draft: LlmPlannerDraft,
    catalog: RelatedCatalog,
  ): boolean {
    const indexById = new Map(
      [...catalog.lessonIdByIndex.entries()].map(([n, id]) => [id, n]),
    );
    const indices = draft.phases
      .flatMap((p) => p.lesson_ids)
      .map((id) => indexById.get(id))
      .filter((n): n is number => n !== undefined);
    if (indices.length < 6) return false;

    let ascending = 0;
    for (let i = 1; i < indices.length; i++) {
      if (indices[i]! > indices[i - 1]!) ascending += 1;
    }
    const ascRatio = ascending / (indices.length - 1);
    let steps1 = 0;
    for (let i = 1; i < indices.length; i++) {
      if (indices[i]! - indices[i - 1]! === 1) steps1 += 1;
    }
    const contigRatio = steps1 / (indices.length - 1);
    return ascRatio > 0.85 && contigRatio > 0.55;
  }

  private deterministicDraft(
    catalog: RelatedCatalog,
    knownSkills: string[],
    seed: number,
  ): LlmPlannerDraft {
    const known = new Set(knownSkills.map((s) => s.toLowerCase()));
    const eligible = catalog.lessons.filter((l) => {
      const hay = `${l.sk} ${l.t}`.toLowerCase();
      return ![...known].some((k) => k && hay.includes(k));
    });
    const pool = this.seedShuffle(
      eligible.length ? eligible : catalog.lessons,
      seed ^ 0x9e3779b9,
    ).slice(0, 20);

    const phases: LlmPlannerDraft['phases'] = [];
    const chunk = Math.max(3, Math.ceil(pool.length / 4));
    for (let i = 0; i < pool.length; i += chunk) {
      const slice = pool.slice(i, i + chunk);
      const ids = slice
        .map((l) => catalog.lessonIdByIndex.get(l.n))
        .filter((id): id is string => Boolean(id));
      if (!ids.length) continue;
      phases.push({
        key: `phase-${phases.length + 1}`,
        title: `Stage ${phases.length + 1}`,
        lesson_ids: ids,
      });
    }

    if (!phases.length) {
      throw new Error('No catalog lessons available for roadmap');
    }

    return {
      title: 'Your Custom Path',
      description: 'Personalized path from your interview answers.',
      why: 'Fallback: known skills skipped, order seeded from your profile.',
      phases,
    };
  }

  private hydratePlan(input: {
    draft: LlmPlannerDraft;
    snapshot: ContentSnapshotDto;
    catalog: RelatedCatalog;
    seed: number;
    hours: number;
    weeks: number;
  }): RoadmapPlanDto {
    const skillById = new Map(input.snapshot.skills.map((s) => [s.id, s]));
    const stackBySlug = new Map(
      input.snapshot.stacks.map((s) => [s.slug, s] as const),
    );
    const budget = budgetMinutes(input.hours, input.weeks);
    let usedMinutes = 0;
    const phases: SelectedPhaseDto[] = [];
    const explanations: RoadmapPlanDto['explanations'] = [];
    let globalOrder = 0;
    let weekCursor = 1;

    for (const draftPhase of input.draft.phases) {
      const milestones: SelectedMilestoneDto[] = [];
      let stackSlug: string | null = null;
      let stackId: string | null = null;

      for (const lessonId of draftPhase.lesson_ids) {
        const lesson =
          input.catalog.lessonById.get(lessonId) ??
          input.snapshot.lessons.find((l) => l.id === lessonId);
        if (!lesson) continue;

        const mins = lesson.estimated_minutes || 20;
        if (
          usedMinutes + mins > budget &&
          milestones.length + phases.length > 0
        ) {
          break;
        }
        usedMinutes += mins;

        const skill = skillById.get(lesson.skill_node_id);
        if (!stackSlug && skill?.tech_stack_slug) {
          stackSlug = skill.tech_stack_slug;
          stackId = stackBySlug.get(stackSlug)?.id ?? null;
        }

        const selected: SelectedLessonDto = {
          source_template_id: lesson.id,
          source_version_id: lesson.published_version_id,
          skill_node_id: lesson.skill_node_id,
          title: lesson.title,
          mission_name: lesson.mission_name_template,
          lesson_type: lesson.lesson_type,
          estimated_minutes: lesson.estimated_minutes,
          difficulty: lesson.difficulty,
          xp_reward: lesson.xp_reward,
          reward_class: lesson.reward_class,
          resource_id: lesson.default_resource_id,
          status: 'locked',
          content_outline: lesson.content_outline ?? {},
          week_index: weekCursor,
          explanation: {
            skill_node: lesson.skill_node_id,
            chosen_lesson_version: lesson.published_version_id,
            reason: 'llm_lesson_pick',
            score_breakdown: { pathOrder: globalOrder },
            alternatives_considered: 0,
          },
        };
        if (selected.explanation) explanations.push(selected.explanation);

        milestones.push({
          skill_node_id: lesson.skill_node_id,
          title: skill?.title ?? lesson.title,
          type: 'skill',
          compress: false,
          order_index: milestones.length,
          xp_reward: selected.xp_reward || 0,
          lessons: [selected],
        });
        globalOrder += 1;
        weekCursor += 1;
      }

      if (!milestones.length) continue;

      phases.push({
        key: draftPhase.key,
        title: draftPhase.title,
        tech_stack_id: stackId,
        tech_stack_slug: stackSlug,
        order_index: phases.length,
        locked: phases.length > 0,
        week_type: 'learning',
        milestones,
      });

      if (usedMinutes >= budget) break;
    }

    if (!phases.length) {
      throw new Error('LLM planner produced empty phases after hydrate');
    }

    const first = phases[0]?.milestones[0]?.lessons[0];
    if (first) first.status = 'available';

    const estimatedWeeks = Math.max(
      1,
      Math.min(
        input.weeks,
        Math.ceil(usedMinutes / Math.max(input.hours * 60, 1)),
      ),
    );

    const description = [input.draft.description, input.draft.why]
      .filter(Boolean)
      .join(' — ')
      .slice(0, 500);

    return {
      title: input.draft.title,
      description,
      primary_role_slug: input.snapshot.recipe.target_role_slug,
      recipe_id: input.snapshot.recipe.id,
      timeline_weeks: input.weeks,
      weekly_hours_target: input.hours,
      estimated_weeks: estimatedWeeks,
      estimated_completion_date: null,
      engine_version: 2,
      seed: input.seed,
      content_version: input.snapshot.content_version,
      phases,
      skipped_known: [],
      explanations,
      schedule_meta: {
        mode: 'llm',
        promptVersion: ROADMAP_LLM_PLANNER_PROMPT_VERSION,
        budgetMinutes: budget,
        usedMinutes,
        why: input.draft.why,
        catalogLessonCount: input.catalog.lessons.length,
        catalogCourseCount: input.catalog.courses.length,
        pathLessonCount: globalOrder,
      },
    };
  }
}
