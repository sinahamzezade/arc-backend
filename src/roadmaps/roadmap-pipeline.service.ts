import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import {
  CONTENT_SAFETY_FACTOR,
  SELECTION_WEIGHTS,
} from '../content-pool/content-pool.constants';
import { Skill } from '../content-pool/entities/skill.entity';
import { Unit } from '../content-pool/entities/unit.entity';
import { UnitsCatalogService } from '../content-pool/units-catalog.service';
import {
  prerequisiteClosure,
  topologicalSortSkills,
  type SkillIndexEntry,
} from '../content-pool/units-graph.util';
import { Goal } from '../goals/entities/goal.entity';
import { RoleRecipe } from '../skill-graph/entities/role-recipe.entity';
import { SkillGraphService } from '../skill-graph/skill-graph.service';
import type {
  ExplanationTraceDto,
  LearnerProfileDto,
  LearnerSkillEstimateDto,
  RoadmapPlanDto,
  SelectedLessonDto,
  SelectedMilestoneDto,
  SelectedPhaseDto,
} from './dto/roadmap-engine.types';
import type {
  NarratorLearner,
  NarratorLesson,
} from './roadmap-narrator.prompt';
import { RoadmapNarratorService } from './roadmap-narrator.service';
import { decodeTimelineWeeks, decodeWeeklyHours } from './token-decoders';

export type PipelinePlanResult = {
  plan: RoadmapPlanDto;
  model: string;
  promptVersion: string;
  /** true when narrator output was repaired via deterministic slicing. */
  usedFallback: boolean;
};

/** One unit scheduled for one skill, in final study order. */
type OrderedLesson = {
  unit: Unit;
  skillId: string;
  skillTitle: string;
  required: boolean;
  score: number;
  breakdown: Record<string, number>;
  /** Stage-aware plan for the skill this unit was selected for. */
  action: SkillAction;
};

/** Per-skill stage-aware plan derived from the learner profile. */
export type SkillAction = 'foundation' | 'refresher' | 'checkpoint' | 'omit';

type SkillPlan = {
  action: SkillAction;
  /** Stage the learner enters this skill at (verified ?? provisional ?? 1). */
  entryStage: number;
};

const SKIP_EXPOSURE_LEVELS = new Set([
  'use_independently',
  'use_professionally',
  'professionally',
]);

const FORMAT_ORDER: Record<string, number> = {
  reading: 0,
  video: 1,
  doing: 2,
  practice: 2,
  quiz: 3,
};

/**
 * Deterministic units pipeline. The app owns selection and order:
 *   1. skill gap  = recipe.requiredSkillIds − known skills (+ prereq closure)
 *   2. topo sort gap skills
 *   3. per-skill unit candidates, learning-style format filter
 *   4. within-skill scoring (SELECTION_WEIGHTS) + format balance
 *   5. budget packing (required first, throw if required alone won't fit)
 *   6. LLM narrator groups + describes — never adds/removes/reorders
 */
@Injectable()
export class RoadmapPipelineService {
  private readonly logger = new Logger(RoadmapPipelineService.name);

  constructor(
    private readonly skillGraph: SkillGraphService,
    private readonly unitsCatalog: UnitsCatalogService,
    private readonly narrator: RoadmapNarratorService,
  ) {}

  getPromptVersion(): string {
    return this.narrator.getPromptVersion();
  }

  async plan(input: {
    goal: Goal;
    profile: LearnerProfileDto;
    seed: number;
  }): Promise<PipelinePlanResult> {
    const recipe = await this.loadRecipe(input.profile);
    const skills = await this.unitsCatalog.listActiveSkills();
    const units = await this.unitsCatalog.listActiveUnits(undefined, {
      includeContent: false,
    });
    if (!skills.length || !units.length) {
      throw new AppException(
        AuthErrorCode.CONTENT_NOT_FOUND,
        'Units catalog is empty — import a units package first',
        HttpStatus.CONFLICT,
      );
    }

    // Capacity: prefer the profile's schedule-discounted effective minutes
    // (capacity sustainability already applied upstream); the content safety
    // factor still applies on top.
    const effectiveMinutes = input.profile.weekly_effective_minutes;
    const hours =
      effectiveMinutes != null && effectiveMinutes > 0
        ? effectiveMinutes / 60
        : decodeWeeklyHours(input.goal.weeklyHours);
    const weeks = decodeTimelineWeeks(
      input.goal.targetDeadline,
      recipe.defaultTimelineWeeks,
    );
    const budget = Math.round(hours * weeks * 60 * CONTENT_SAFETY_FACTOR);

    // Stage 1: per-skill stage-aware plan (foundation|refresher|checkpoint|omit)
    const skillPlans = this.resolveSkillPlans(skills, input.profile);
    const knownSkillIds = new Set(
      [...skillPlans.entries()]
        .filter(([, p]) => p.action === 'omit')
        .map(([id]) => id),
    );
    const { requiredGap, optionalGap } = this.computeGap(
      recipe,
      skills,
      knownSkillIds,
    );

    // Stage 2: topo order
    const orderedGapSkills = this.topoOrderGap(
      skills,
      requiredGap,
      optionalGap,
    );

    // Stages 3-4: per-skill candidates, format filter, scoring, format balance
    const ordered = this.selectUnitsPerSkill(
      orderedGapSkills,
      units,
      requiredGap,
      knownSkillIds,
      input.profile.learning_styles,
      skillPlans,
    );

    // Stage 5: budget packing (required floor guaranteed)
    const packed = this.packBudget(ordered, requiredGap, budget);
    if (!packed.length) {
      throw new AppException(
        AuthErrorCode.CONTENT_NOT_FOUND,
        'No units matched the learner skill gap',
        HttpStatus.CONFLICT,
      );
    }

    this.logger.log(
      `[roadmap-pipeline] goal=${input.goal.id} known=${knownSkillIds.size} gapRequired=${requiredGap.size} gapOptional=${optionalGap.size} candidates=${ordered.length} packed=${packed.length} budget=${budget}m`,
    );

    // Stage 6: narration
    const narratorLessons: NarratorLesson[] = packed.map((row, i) => ({
      i,
      title: row.unit.title,
      skill: row.skillTitle,
      minutes: row.unit.estimatedMinutes,
      type: row.unit.lessonType,
    }));
    const learner: NarratorLearner = {
      goal: recipe.title,
      weeks,
      hoursPerWeek: hours,
      styles: input.profile.learning_styles ?? [],
      level: input.profile.confidence,
      quitReason: (input.profile.quit_reasons ?? []).join(', '),
    };
    const narration = await this.narrator.narrate({
      userId: input.goal.userId,
      learner,
      lessons: narratorLessons,
    });

    const plan = this.hydratePlan({
      recipe,
      packed,
      narration: narration.draft,
      knownSkillIds,
      seed: input.seed,
      hours,
      weeks,
      budget,
      repaired: narration.repaired,
    });

    return {
      plan,
      model: narration.model,
      promptVersion: narration.promptVersion,
      usedFallback: narration.repaired,
    };
  }

  private async loadRecipe(profile: LearnerProfileDto): Promise<RoleRecipe> {
    const recipe = await this.skillGraph.findFirstRecipeForRoles(
      profile.target_roles ?? [],
    );
    if (!recipe) {
      throw new AppException(
        AuthErrorCode.CONTENT_ROLE_RECIPE_MISSING,
        `No role recipe for ${(profile.target_roles ?? []).join(', ') || '(none)'}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return recipe;
  }

  /**
   * Stage-aware per-skill plan. With profile skill estimates each catalog
   * skill resolves (via its `domain:` prefix) to a coarse estimate and gets an
   * action: omit only when the stage is verified at/above target, or when a
   * high provisional stage is backed by medium/high confidence, independent/
   * professional exposure, and no pending diagnostic for that skill. High but
   * unverified → checkpoint; partial exposure → refresher; else foundation.
   * Without estimates, falls back to legacy known-skills token matching
   * (matched → omit).
   */
  private resolveSkillPlans(
    skills: Skill[],
    profile: LearnerProfileDto,
  ): Map<string, SkillPlan> {
    const plans = new Map<string, SkillPlan>();
    const estimates = profile.skill_estimates;

    if (!estimates?.length) {
      const known = this.matchKnownSkills(skills, profile.known_skills);
      for (const skill of skills) {
        plans.set(skill.id, {
          action: known.has(skill.id) ? 'omit' : 'foundation',
          entryStage: 1,
        });
      }
      return plans;
    }

    const bySlug = new Map<string, LearnerSkillEstimateDto>(
      estimates.map((e) => [e.skill_slug.toLowerCase(), e]),
    );
    const targetStage = profile.target_stage ?? 4;

    for (const skill of skills) {
      const coarseSlug = (
        skill.id.includes(':') ? skill.id.split(':')[0] : skill.id
      ).toLowerCase();
      const estimate = bySlug.get(coarseSlug);
      if (!estimate) {
        plans.set(skill.id, { action: 'foundation', entryStage: 1 });
        continue;
      }
      plans.set(skill.id, {
        action: this.resolveSkillAction(estimate, targetStage),
        entryStage: Math.max(
          1,
          estimate.verified_stage ?? estimate.provisional_stage ?? 1,
        ),
      });
    }
    return plans;
  }

  private resolveSkillAction(
    estimate: LearnerSkillEstimateDto,
    targetStage: number,
  ): SkillAction {
    if (
      estimate.verified_stage != null &&
      estimate.verified_stage >= targetStage
    ) {
      return 'omit';
    }

    const provisionalHigh = estimate.provisional_stage >= targetStage;
    const confidenceOk =
      estimate.confidence === 'high' || estimate.confidence === 'medium';
    const exposureOk = SKIP_EXPOSURE_LEVELS.has(
      estimate.self_exposure_level?.toLowerCase() ?? '',
    );

    if (
      provisionalHigh &&
      confidenceOk &&
      exposureOk &&
      !estimate.diagnostic_required
    ) {
      return 'omit';
    }
    if (provisionalHigh && confidenceOk) return 'checkpoint';
    if (estimate.provisional_stage >= 2) return 'refresher';
    return 'foundation';
  }

  /** Substring/token match of learner-claimed skills against the catalog. */
  private matchKnownSkills(
    skills: Skill[],
    knownTokens: string[],
  ): Set<string> {
    const tokens = (knownTokens ?? [])
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t && t !== 'none');
    const known = new Set<string>();
    if (!tokens.length) return known;

    for (const skill of skills) {
      const localSlug = (skill.id.split(':').pop() ?? skill.id).toLowerCase();
      const title = skill.title.toLowerCase();
      const hit = tokens.some(
        (token) =>
          localSlug.includes(token) ||
          token.includes(localSlug) ||
          title.includes(token) ||
          token.includes(title),
      );
      if (hit) known.add(skill.id);
    }
    return known;
  }

  private computeGap(
    recipe: RoleRecipe,
    skills: Skill[],
    knownSkillIds: Set<string>,
  ): { requiredGap: Set<string>; optionalGap: Set<string> } {
    const catalogIds = new Set(skills.map((s) => s.id));
    const skillsById = new Map<string, SkillIndexEntry>(
      skills.map((s) => [s.id, this.toIndexEntry(s)]),
    );

    const required = (recipe.requiredSkillIds ?? []).filter((id) =>
      catalogIds.has(id),
    );
    const optional = (recipe.optionalSkillIds ?? []).filter((id) =>
      catalogIds.has(id),
    );

    let requiredSeed = required.filter((id) => !knownSkillIds.has(id));
    if (!requiredSeed.length && required.length) {
      // Learner claims to know everything — keep the required track as refresh.
      this.logger.warn(
        `[roadmap-pipeline] all required skills matched as known — keeping full required track`,
      );
      requiredSeed = [...required];
    }

    const requiredGap = new Set(
      [...prerequisiteClosure(requiredSeed, skillsById)].filter(
        (id) => !knownSkillIds.has(id) || requiredSeed.includes(id),
      ),
    );

    const optionalSeed = optional.filter(
      (id) => !knownSkillIds.has(id) && !requiredGap.has(id),
    );
    const optionalGap = new Set(
      [...prerequisiteClosure(optionalSeed, skillsById)].filter(
        (id) => !knownSkillIds.has(id) && !requiredGap.has(id),
      ),
    );

    return { requiredGap, optionalGap };
  }

  /** Topo sort of the whole catalog, filtered to gap skills. */
  private topoOrderGap(
    skills: Skill[],
    requiredGap: Set<string>,
    optionalGap: Set<string>,
  ): Array<{ entry: SkillIndexEntry; required: boolean }> {
    const sorted = topologicalSortSkills(
      skills.map((s) => this.toIndexEntry(s)),
    );
    const out: Array<{ entry: SkillIndexEntry; required: boolean }> = [];
    for (const entry of sorted) {
      if (requiredGap.has(entry.id)) out.push({ entry, required: true });
      else if (optionalGap.has(entry.id)) out.push({ entry, required: false });
    }
    return out;
  }

  /**
   * Stages 3-4. For each ordered gap skill: gather units teaching it, prefer
   * units whose serves_stage includes the learner's entry stage and whose
   * unit_role matches the planned action, apply the learning-style format
   * filter (never dropping the last covering unit), score with
   * SELECTION_WEIGHTS and order for reading→doing→quiz balance.
   */
  private selectUnitsPerSkill(
    orderedSkills: Array<{ entry: SkillIndexEntry; required: boolean }>,
    units: Unit[],
    requiredGap: Set<string>,
    knownSkillIds: Set<string>,
    learningStyles: string[],
    skillPlans: Map<string, SkillPlan>,
  ): OrderedLesson[] {
    const styles = (learningStyles ?? [])
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const unitsBySkill = new Map<string, Unit[]>();
    for (const unit of units) {
      for (const skillId of unit.skillsTaught ?? []) {
        const list = unitsBySkill.get(skillId) ?? [];
        list.push(unit);
        unitsBySkill.set(skillId, list);
      }
    }

    const scheduledSkills = new Set<string>();
    const usedUnits = new Set<string>();
    const out: OrderedLesson[] = [];

    for (const { entry, required } of orderedSkills) {
      const allCandidates = (unitsBySkill.get(entry.id) ?? []).filter(
        (u) => !usedUnits.has(u.id),
      );
      if (!allCandidates.length) {
        this.logger.warn(
          `[roadmap-pipeline] no units cover gap skill "${entry.id}"`,
        );
        continue;
      }

      const plan = skillPlans.get(entry.id) ?? {
        action: 'foundation' as SkillAction,
        entryStage: 1,
      };
      const candidates = this.preferStageRoleUnits(allCandidates, plan);

      const kept = this.keepStyleMatchesWithEvidence(candidates, styles);

      const scored = kept.map((unit) => {
        const prereqReady = (unit.prerequisites ?? []).every(
          (p) =>
            knownSkillIds.has(p) ||
            scheduledSkills.has(p) ||
            (unit.skillsTaught ?? []).includes(p),
        );
        const styleOverlap = this.styleOverlapCount(unit.formats ?? [], styles);
        const breakdown = {
          roleFit: 1,
          skillGapFit: required ? 1 : 0.6,
          prerequisiteReadiness: prereqReady ? 1 : 0.4,
          learningStyleFit:
            styles.length === 0
              ? 0.7
              : Math.min(
                  1,
                  styleOverlap / Math.max(1, (unit.formats ?? []).length),
                ),
          timeFit: unit.estimatedMinutes <= 45 ? 1 : 0.7,
          qualityScore: 0.8,
        };
        const score =
          breakdown.roleFit * SELECTION_WEIGHTS.roleFit +
          breakdown.skillGapFit * SELECTION_WEIGHTS.skillGapFit +
          breakdown.prerequisiteReadiness *
            SELECTION_WEIGHTS.prerequisiteReadiness +
          breakdown.learningStyleFit * SELECTION_WEIGHTS.learningStyleFit +
          breakdown.timeFit * SELECTION_WEIGHTS.timeFit +
          breakdown.qualityScore * SELECTION_WEIGHTS.qualityScore;
        return { unit, score, breakdown };
      });

      // Format balance: reading → doing → quiz, then score, then stable id.
      scored.sort((a, b) => {
        const fa = this.formatRank(a.unit);
        const fb = this.formatRank(b.unit);
        if (fa !== fb) return fa - fb;
        if (a.score !== b.score) return b.score - a.score;
        return a.unit.id.localeCompare(b.unit.id);
      });

      for (const row of scored) {
        usedUnits.add(row.unit.id);
        out.push({
          unit: row.unit,
          skillId: entry.id,
          skillTitle: entry.title,
          required: requiredGap.has(entry.id),
          score: row.score,
          breakdown: row.breakdown,
          action: plan.action,
        });
      }
      scheduledSkills.add(entry.id);
    }

    return out;
  }

  /**
   * Prefer units whose serves_stage spans the entry path and whose
   * unit_role matches the planned action. Foundation keeps the full teaching
   * path; refresher/checkpoint narrow to lighter units when authored,
   * falling back to whatever covers the skill so no skill is left empty.
   */
  private preferStageRoleUnits(candidates: Unit[], plan: SkillPlan): Unit[] {
    const stageMatches = (u: Unit) =>
      !(u.servesStage ?? []).length ||
      (u.servesStage ?? []).some((stage) => stage >= plan.entryStage);

    const roleTiers: string[][] =
      plan.action === 'checkpoint'
        ? [['checkpoint'], ['checkpoint', 'refresher']]
        : plan.action === 'refresher'
          ? [['refresher', 'checkpoint']]
          : [];

    for (const roles of roleTiers) {
      const roleSet = new Set(roles);
      const byStageAndRole = candidates.filter(
        (u) => roleSet.has(u.unitRole) && stageMatches(u),
      );
      if (byStageAndRole.length) return byStageAndRole;
      const byRole = candidates.filter((u) => roleSet.has(u.unitRole));
      if (byRole.length) return byRole;
    }

    const byStage = candidates.filter(stageMatches);
    return byStage.length ? byStage : candidates;
  }

  /**
   * Learning style can bias formats, but it cannot remove the proof that lets
   * a learner advance. Keep checkpoint/proof units alongside matching formats.
   */
  private keepStyleMatchesWithEvidence(
    candidates: Unit[],
    styles: string[],
  ): Unit[] {
    const matching = candidates.filter((u) =>
      this.formatsMatchStyles(u.formats ?? [], styles),
    );
    if (!matching.length) return candidates;

    const kept = new Map(matching.map((u) => [u.id, u] as const));
    for (const unit of candidates) {
      if (unit.unitRole === 'checkpoint' || unit.unitRole === 'proof') {
        kept.set(unit.id, unit);
      }
    }
    return [...kept.values()];
  }

  private formatRank(unit: Unit): number {
    const ranks = (unit.formats ?? [])
      .map((f) => FORMAT_ORDER[f.toLowerCase()])
      .filter((r): r is number => r !== undefined);
    if (!ranks.length) {
      const byType = FORMAT_ORDER[unit.lessonType?.toLowerCase() ?? ''];
      return byType ?? 4;
    }
    return Math.min(...ranks);
  }

  /** Loose token match: "quizzes"⇔"quiz", "reading"⇔"reading", etc. */
  private formatsMatchStyles(formats: string[], styles: string[]): boolean {
    if (!styles.length || !formats.length) return true;
    return this.styleOverlapCount(formats, styles) > 0;
  }

  private styleOverlapCount(formats: string[], styles: string[]): number {
    let overlap = 0;
    for (const format of formats) {
      const f = format.toLowerCase();
      if (styles.some((s) => s.includes(f) || f.includes(s))) overlap += 1;
    }
    return overlap;
  }

  /**
   * Stage 5. Pack required first with a reservation so every required skill
   * keeps at least its cheapest unit; optional units fill leftover budget.
   * Throws CONTENT_REQUIRED_BUDGET_EXCEEDED when even the floor won't fit.
   */
  private packBudget(
    ordered: OrderedLesson[],
    requiredGap: Set<string>,
    budget: number,
  ): OrderedLesson[] {
    const required = ordered.filter((l) => l.required);
    const optional = ordered.filter((l) => !l.required);

    const cheapestBySkill = new Map<string, number>();
    for (const row of required) {
      const prev = cheapestBySkill.get(row.skillId);
      if (prev === undefined || row.unit.estimatedMinutes < prev) {
        cheapestBySkill.set(row.skillId, row.unit.estimatedMinutes);
      }
    }
    const floorMinutes = [...cheapestBySkill.values()].reduce(
      (a, b) => a + b,
      0,
    );
    if (floorMinutes > budget) {
      throw new AppException(
        AuthErrorCode.CONTENT_REQUIRED_BUDGET_EXCEEDED,
        `Required content needs at least ${floorMinutes}m but budget is ${budget}m — extend the timeline or weekly hours`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const packed: OrderedLesson[] = [];
    const coveredSkills = new Set<string>();
    let used = 0;

    // Reserve the cheapest unit for every required skill not yet covered.
    const requiredSkillOrder: string[] = [];
    for (const row of required) {
      if (!requiredSkillOrder.includes(row.skillId)) {
        requiredSkillOrder.push(row.skillId);
      }
    }
    const reserveAfter = (skillId: string): number => {
      const idx = requiredSkillOrder.indexOf(skillId);
      return requiredSkillOrder
        .slice(idx + 1)
        .filter((id) => !coveredSkills.has(id))
        .reduce((sum, id) => sum + (cheapestBySkill.get(id) ?? 0), 0);
    };

    for (const row of required) {
      const mins = row.unit.estimatedMinutes;
      const isFirstForSkill = !coveredSkills.has(row.skillId);
      const reserve = reserveAfter(row.skillId);
      if (isFirstForSkill) {
        packed.push(row);
        used += mins;
        coveredSkills.add(row.skillId);
        continue;
      }
      if (used + mins + reserve <= budget) {
        packed.push(row);
        used += mins;
      }
    }

    for (const row of optional) {
      const mins = row.unit.estimatedMinutes;
      if (used + mins <= budget) {
        packed.push(row);
        used += mins;
      }
    }

    // Optional units were appended budget-greedily; restore global skill order.
    const orderIndex = new Map(ordered.map((l, i) => [l.unit.id, i] as const));
    packed.sort(
      (a, b) =>
        (orderIndex.get(a.unit.id) ?? 0) - (orderIndex.get(b.unit.id) ?? 0),
    );
    return packed;
  }

  private hydratePlan(input: {
    recipe: RoleRecipe;
    packed: OrderedLesson[];
    narration: {
      title: string;
      description: string;
      why: string;
      phases: Array<{ key: string; title: string; lessonIndices: number[] }>;
    };
    knownSkillIds: Set<string>;
    seed: number;
    hours: number;
    weeks: number;
    budget: number;
    repaired: boolean;
  }): RoadmapPlanDto {
    const weeklyMinutes = Math.max(input.hours * 60, 1);
    const explanations: ExplanationTraceDto[] = [];
    const phases: SelectedPhaseDto[] = [];
    let usedMinutes = 0;

    for (const draftPhase of input.narration.phases) {
      const milestones: SelectedMilestoneDto[] = [];
      const stackCounts = new Map<string, number>();

      for (const index of draftPhase.lessonIndices) {
        const row = input.packed[index];
        if (!row) continue;
        const unit = row.unit;
        usedMinutes += unit.estimatedMinutes;
        stackCounts.set(unit.stack, (stackCounts.get(unit.stack) ?? 0) + 1);

        const lesson: SelectedLessonDto = {
          source_template_id: unit.id,
          source_version_id: null,
          skill_node_id: row.skillId,
          unit_id: unit.id,
          skill_id: row.skillId,
          provider: unit.provider,
          url: unit.url,
          level: unit.level,
          skills_taught: unit.skillsTaught ?? [],
          unit_role: unit.unitRole ?? null,
          serves_stage: unit.servesStage ?? [],
          entry_action: row.action,
          title: unit.title,
          mission_name: null,
          lesson_type: unit.lessonType,
          estimated_minutes: unit.estimatedMinutes,
          difficulty: this.levelToDifficulty(unit.level),
          xp_reward: unit.xp,
          reward_class: 'standard',
          resource_id: null,
          status: 'locked',
          content_outline: unit.content ?? {},
          week_index: Math.max(1, Math.ceil(usedMinutes / weeklyMinutes)),
          explanation: {
            skill_node: row.skillId,
            chosen_lesson_version: null,
            reason: row.required
              ? 'pipeline_required_gap'
              : 'pipeline_optional_gap',
            score_breakdown: { ...row.breakdown, total: row.score },
            alternatives_considered: 0,
          },
        };
        if (lesson.explanation) explanations.push(lesson.explanation);

        // Milestone per contiguous skill run inside the phase.
        const last = milestones[milestones.length - 1];
        if (last && last.skill_id === row.skillId) {
          last.lessons.push(lesson);
          last.xp_reward += lesson.xp_reward;
        } else {
          milestones.push({
            skill_node_id: row.skillId,
            skill_id: row.skillId,
            title: row.skillTitle,
            type: 'skill',
            compress: false,
            order_index: milestones.length,
            xp_reward: lesson.xp_reward,
            lessons: [lesson],
          });
        }
      }

      if (!milestones.length) continue;

      const dominantStack =
        [...stackCounts.entries()].sort(
          (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
        )[0]?.[0] ?? null;

      phases.push({
        key: draftPhase.key,
        title: draftPhase.title,
        tech_stack_id: null,
        tech_stack_slug: dominantStack,
        order_index: phases.length,
        locked: phases.length > 0,
        week_type: 'learning',
        milestones,
      });
    }

    if (!phases.length) {
      throw new AppException(
        AuthErrorCode.ROADMAP_GENERATION_FAILED,
        'Pipeline produced empty phases after narration',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const first = phases[0]?.milestones[0]?.lessons[0];
    if (first) first.status = 'available';

    const estimatedWeeks = Math.max(
      1,
      Math.min(input.weeks, Math.ceil(usedMinutes / weeklyMinutes)),
    );
    const description = [input.narration.description, input.narration.why]
      .filter(Boolean)
      .join(' — ')
      .slice(0, 500);

    return {
      title: input.narration.title,
      description,
      primary_role_slug: input.recipe.targetRoleSlug,
      recipe_id: input.recipe.id,
      timeline_weeks: input.weeks,
      weekly_hours_target: input.hours,
      estimated_weeks: estimatedWeeks,
      estimated_completion_date: null,
      engine_version: 3,
      seed: input.seed,
      content_version: `units-recipe-${input.recipe.id}-v${input.recipe.version}`,
      phases,
      skipped_known: [...input.knownSkillIds],
      explanations,
      schedule_meta: {
        mode: 'pipeline',
        promptVersion: this.narrator.getPromptVersion(),
        budgetMinutes: input.budget,
        usedMinutes,
        why: input.narration.why,
        narrationRepaired: input.repaired,
        lessonCount: input.packed.length,
      },
    };
  }

  private levelToDifficulty(level: number): string {
    if (level <= 1) return 'beginner';
    if (level === 2) return 'intermediate';
    return 'advanced';
  }

  private toIndexEntry(skill: Skill): SkillIndexEntry {
    return {
      id: skill.id,
      title: skill.title,
      prerequisites: skill.prerequisites ?? [],
      level: skill.level,
    };
  }
}
