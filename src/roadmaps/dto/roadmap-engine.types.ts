/** Mirrors roadmap-engine pydantic contracts (HTTP seam). */

/** Per-skill stage estimate carried from a learner profile snapshot. */
export type LearnerSkillEstimateDto = {
  skill_slug: string;
  self_exposure_level: string;
  provisional_stage: number;
  verified_stage: number | null;
  confidence: string;
  /** true when a placement diagnostic gates skipping this skill. */
  diagnostic_required: boolean;
};

export type LearnerProfileDto = {
  user_id: string;
  goal_id: string;
  goal_revision: string;
  target_roles: string[];
  motivation: string[];
  current_profession: string | null;
  known_skills: string[];
  confidence: string | null;
  weekly_hours_token: string | null;
  availability_days: string[];
  availability_times: string[];
  target_deadline_token: string | null;
  learning_styles: string[];
  quit_reasons: string[];
  language: string;
  interview_signals: Record<string, unknown>;
  proven_mastered_skill_ids: string[];
  /** Stage-aware fields (present when a LearnerProfileSnapshot is pinned). */
  skill_estimates?: LearnerSkillEstimateDto[];
  current_stage?: number;
  target_stage?: number;
  weekly_effective_minutes?: number;
  learning_style_weights?: Record<string, number>;
  pace_class?: string;
};

export type ContentSnapshotDto = {
  content_version: string;
  recipe: {
    id: string;
    target_role_slug: string;
    title: string;
    default_timeline_weeks: number;
    content_version: string;
    required_skill_node_ids: string[];
    optional_skill_node_ids: string[];
    phase_blueprint: Array<{
      key: string;
      title: string;
      tech_stack_slugs: string[];
      required: boolean;
      include_if_confidence_gte?: string | null;
    }>;
    minimum_assessment_rules: Record<string, unknown>;
  };
  stacks: Array<{ id: string; slug: string; title: string }>;
  skills: Array<{
    id: string;
    slug: string;
    title: string;
    tech_stack_id: string | null;
    tech_stack_slug: string | null;
    tags: string[];
    prerequisite_skill_ids: string[];
    estimated_mastery_minutes: number;
    difficulty: string;
    order_hint: number;
    content_version: string;
  }>;
  lessons: Array<{
    id: string;
    skill_node_id: string;
    slug: string;
    title: string;
    mission_name_template: string | null;
    lesson_type: string;
    estimated_minutes: number;
    difficulty: string;
    xp_reward: number;
    reward_class: string;
    learning_style_tags: string[];
    scheduling_tags: string[];
    language: string;
    order_hint: number;
    default_resource_id: string | null;
    published_version_id: string | null;
    content_outline: Record<string, unknown>;
    status: string;
    quality_score: number;
    content_version: string;
  }>;
  resources: Array<{ id: string; title?: string | null }>;
  assessments: Record<string, unknown>[];
  projects: Record<string, unknown>[];
};

export type ExplanationTraceDto = {
  skill_node: string;
  chosen_lesson_version: string | null;
  reason: string;
  score_breakdown: Record<string, number>;
  alternatives_considered: number;
};

export type SelectedLessonDto = {
  source_template_id: string;
  source_version_id: string | null;
  skill_node_id: string;
  /** Units model: flat unit slug id (source_template_id mirrors it). */
  unit_id?: string | null;
  /** Units model: namespaced skill slug (skill_node_id mirrors it). */
  skill_id?: string | null;
  /** Units model: external provider snapshot (e.g. `MDN`). */
  provider?: string | null;
  /** Units model: external resource URL snapshot. */
  url?: string | null;
  /** Units model: unit difficulty level snapshot. */
  level?: number | null;
  /** Units model: skill slugs the unit teaches. */
  skills_taught?: string[];
  /** Units model: unit role (foundation | refresher | checkpoint | ...). */
  unit_role?: string | null;
  /** Units model: learner stages the unit serves. */
  serves_stage?: number[];
  /** Stage-aware plan action for the skill this unit was selected for. */
  entry_action?: string | null;
  title: string;
  mission_name: string | null;
  lesson_type: string;
  estimated_minutes: number;
  difficulty: string;
  xp_reward: number;
  reward_class: string;
  resource_id: string | null;
  status: 'locked' | 'available' | 'completed';
  content_outline: Record<string, unknown>;
  week_index: number | null;
  explanation: ExplanationTraceDto | null;
  /** Required lessons block roadmap graduation; defaults true when omitted. */
  required?: boolean;
};

export type SelectedMilestoneDto = {
  skill_node_id: string;
  /** Units model: namespaced skill slug (skill_node_id mirrors it). */
  skill_id?: string | null;
  title: string;
  type: string;
  compress: boolean;
  order_index: number;
  xp_reward: number;
  lessons: SelectedLessonDto[];
};

export type SelectedPhaseDto = {
  key: string;
  title: string;
  /** Identity-progression title from role recipe phaseNarrativeTitles. */
  narrative_title?: string | null;
  tech_stack_id: string | null;
  tech_stack_slug: string | null;
  order_index: number;
  locked: boolean;
  week_type: string;
  milestones: SelectedMilestoneDto[];
};

export type RoadmapPlanDto = {
  title: string;
  description: string;
  primary_role_slug: string;
  recipe_id: string;
  timeline_weeks: number;
  weekly_hours_target: number;
  estimated_weeks: number;
  estimated_completion_date: string | null;
  engine_version: number;
  seed: number;
  content_version: string;
  phases: SelectedPhaseDto[];
  skipped_known: string[];
  explanations: ExplanationTraceDto[];
  schedule_meta: Record<string, unknown>;
};

export type PlanResponseDto = {
  ok: boolean;
  plan: RoadmapPlanDto | null;
  feasibility: {
    feasible: boolean;
    code: string | null;
    message: string | null;
    earliest_realistic_weeks: number | null;
    earliest_realistic_date: string | null;
  } | null;
  error_code: string | null;
  error_message: string | null;
};

export type ReplanCurrentStateDto = {
  roadmap_id: string;
  completed_lesson_template_ids: string[];
  completed_skill_node_ids: string[];
  completed_phase_keys: string[];
  current_week: number;
  trigger: string;
  prior_plan: Record<string, unknown> | null;
};
