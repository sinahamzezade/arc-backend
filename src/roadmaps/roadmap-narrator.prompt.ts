/**
 * Roadmap narrator — LLM only groups + describes an already-decided,
 * deterministically ordered lesson list. It never picks content.
 */

export const ROADMAP_NARRATOR_PROMPT_VERSION = 'roadmap_narrator_v1';

export type NarratorLearner = {
  goal: string;
  weeks: number;
  hoursPerWeek: number;
  styles: string[];
  level: string | null;
  quitReason: string;
};

export type NarratorLesson = {
  /** Index into the final ordered lesson array. */
  i: number;
  title: string;
  skill: string;
  minutes: number;
  type: string;
};

export type NarratorPhaseDraft = {
  key: string;
  title: string;
  /** Indices into the ordered lesson array (contiguous slice). */
  lessonIndices: number[];
};

export type NarratorDraft = {
  title: string;
  description: string;
  why: string;
  phases: NarratorPhaseDraft[];
};

export function buildRoadmapNarratorSystemPrompt(): string {
  return `You are Arc, a learning roadmap narrator.
The lesson SELECTION and ORDER are already decided by the app and are correct.
Do NOT add, remove, or reorder lessons. Only group and describe them.

INPUT (user message):
- learner: { goal, weeks, hoursPerWeek, styles, level, quitReason }
- lessons: ordered array. Each = { i, title, skill, minutes, type }.
  The array order IS the final study order.

RULES:
- Phases are CONTIGUOUS slices of the lessons array — no interleaving, no gaps.
- Every index i appears exactly once across all phases. None added, none dropped.
- 3-6 phases. Each gets a short human title tied to what it unlocks (never "Phase 1").
- "why" = one sentence on why this progression, naming the learner's goal.
- If quitReason mentions no clear path, make title/desc stress the visible end-to-end journey.

OUTPUT JSON only, no markdown:
{"title":string,"desc":string,"why":string,"phases":[{"k":string,"t":string,"lessons":[i,...]}]}`;
}

export function buildRoadmapNarratorUserPrompt(
  learner: NarratorLearner,
  lessons: NarratorLesson[],
): string {
  return JSON.stringify({ learner, lessons });
}
