/**
 * Dynamic lesson reward model — gamification.md §5.
 * Rule version: see reward-constants.ts (lesson-reward-v3).
 */

export type LessonActionKind =
  | 'video'
  | 'audio'
  | 'reading'
  | 'guided'
  | 'reflection'
  | 'quiz'
  | 'coding'
  | 'dataset'
  | 'debugging'
  | 'mini_project'
  | 'mini_challenge'
  | 'boss'
  | 'project_milestone'
  | 'capstone';

export type DifficultyBand =
  | 'intro'
  | 'beginner'
  | 'intermediate'
  | 'advanced'
  | 'expert';

export type AssistanceLevel =
  | 'none'
  | 'hint'
  | 'premium_hint'
  | 'remove_options'
  | 'solution';

export const BASE_REWARDS: Record<
  LessonActionKind,
  { xp: number; gems: number; coins: number }
> = {
  video: { xp: 10, gems: 0, coins: 8 },
  audio: { xp: 10, gems: 0, coins: 8 },
  reading: { xp: 12, gems: 0, coins: 8 },
  guided: { xp: 18, gems: 1, coins: 12 },
  reflection: { xp: 15, gems: 1, coins: 10 },
  quiz: { xp: 25, gems: 2, coins: 15 },
  coding: { xp: 32, gems: 3, coins: 20 },
  dataset: { xp: 36, gems: 3, coins: 22 },
  debugging: { xp: 38, gems: 4, coins: 24 },
  mini_project: { xp: 55, gems: 5, coins: 35 },
  mini_challenge: { xp: 80, gems: 8, coins: 50 },
  boss: { xp: 140, gems: 15, coins: 90 },
  project_milestone: { xp: 180, gems: 20, coins: 120 },
  capstone: { xp: 300, gems: 35, coins: 200 },
};

export const DIFFICULTY_MULT: Record<DifficultyBand, number> = {
  intro: 0.8,
  beginner: 1.0,
  intermediate: 1.25,
  advanced: 1.55,
  expert: 1.9,
};

export const ASSISTANCE_MULT: Record<AssistanceLevel, number> = {
  none: 1.0,
  hint: 0.95,
  premium_hint: 0.85,
  remove_options: 0.8,
  solution: 0.4,
};

export const XP_CAP = 1_000;
export const GEMS_CAP = 75;
export const COINS_CAP = 500;

/** Phase XP gates — gamification.md §7.2 */
export const XP_GATES = [
  { key: 'foundation', minXp: 500 },
  { key: 'core', minXp: 2_000 },
  { key: 'applied', minXp: 6_000 },
  { key: 'advanced', minXp: 12_000 },
  { key: 'portfolio', minXp: 20_000 },
  { key: 'interview', minXp: 35_000 },
  { key: 'readiness', minXp: 60_000 },
] as const;

export function positionMultiplier(percentile: number): number {
  const p = Math.max(0, Math.min(100, percentile));
  if (p <= 20) return 0.8;
  if (p <= 50) return 1.0;
  if (p <= 75) return 1.2;
  if (p <= 90) return 1.4;
  return 1.65;
}

export function performanceMultiplier(
  quizCorrect: number,
  quizTotal: number,
): number {
  if (quizTotal <= 0) return 1.0;
  const pct = (quizCorrect / quizTotal) * 100;
  if (pct >= 100) return 1.3;
  if (pct >= 90) return 1.15;
  if (pct >= 75) return 1.0;
  if (pct >= 60) return 0.8;
  return 0.8;
}

export function normalizeDifficulty(raw: string | null | undefined): DifficultyBand {
  const d = (raw || 'beginner').toLowerCase();
  if (d.includes('intro')) return 'intro';
  if (d.includes('expert') || d.includes('master')) return 'expert';
  if (d.includes('advanc')) return 'advanced';
  if (d.includes('inter')) return 'intermediate';
  return 'beginner';
}

/** Map catalog lessonType / rewardClass → action band before title heuristics. */
export function actionKindFromLessonType(
  lessonType?: string | null,
  rewardClass?: string | null,
): LessonActionKind | undefined {
  const raw = `${rewardClass ?? ''} ${lessonType ?? ''}`.toLowerCase().trim();
  if (!raw) return undefined;
  if (raw.includes('capstone') || raw.includes('final')) return 'capstone';
  if (raw.includes('boss')) return 'boss';
  if (raw.includes('milestone')) return 'project_milestone';
  if (raw.includes('challenge')) return 'mini_challenge';
  if (raw.includes('mini_project') || raw.includes('mini-project')) {
    return 'mini_project';
  }
  if (raw.includes('debug')) return 'debugging';
  if (raw.includes('dataset')) return 'dataset';
  if (raw.includes('practice') || raw.includes('coding') || raw.includes('code')) {
    return 'coding';
  }
  if (raw.includes('quiz') || raw.includes('check')) return 'quiz';
  if (raw.includes('reflect')) return 'reflection';
  if (raw.includes('guided') || raw.includes('example')) return 'guided';
  if (raw.includes('video') || raw.includes('watch')) return 'video';
  if (raw.includes('audio') || raw.includes('listen')) return 'audio';
  if (raw.includes('read')) return 'reading';
  if (raw.includes('project')) return 'mini_project';
  return undefined;
}

export function inferActionKind(input: {
  title?: string;
  track?: string;
  modality?: string;
  estimatedMinutes?: number;
  rewardClass?: string;
}): LessonActionKind {
  const fromType = actionKindFromLessonType(input.modality, input.rewardClass);
  if (fromType) return fromType;

  const blob = `${input.modality ?? ''} ${input.title ?? ''} ${input.track ?? ''}`.toLowerCase();
  if (blob.includes('capstone') || blob.includes('final')) return 'capstone';
  if (blob.includes('boss')) return 'boss';
  if (blob.includes('milestone')) return 'project_milestone';
  if (blob.includes('challenge')) return 'mini_challenge';
  if (blob.includes('project')) return 'mini_project';
  if (blob.includes('debug')) return 'debugging';
  if (blob.includes('dataset') || blob.includes('data ')) return 'dataset';
  if (blob.includes('cod') || blob.includes('practice')) return 'coding';
  if (blob.includes('quiz') || blob.includes('check')) return 'quiz';
  if (blob.includes('reflect')) return 'reflection';
  if (blob.includes('guided') || blob.includes('example')) return 'guided';
  if (blob.includes('video') || blob.includes('watch')) return 'video';
  if (blob.includes('audio') || blob.includes('listen')) return 'audio';
  if (blob.includes('read')) return 'reading';
  if ((input.estimatedMinutes ?? 20) >= 45) return 'mini_project';
  return 'quiz';
}
