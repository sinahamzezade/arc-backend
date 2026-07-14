/**
 * Authoritative lesson play payload stored in
 * lesson_templates.content_outline or lessons.play_content.
 */

export type LessonContentBlock =
  | { type: 'text'; body: string }
  | { type: 'callout'; title: string; body: string }
  | { type: 'code'; label: string; code: string };

export type LessonContentPage = {
  id: string;
  title: string;
  blocks: LessonContentBlock[];
};

export type LessonPracticeOutline = {
  id: string;
  prompt: string;
  hint: string;
  /** Required at seed time (§16.8); optional on legacy outlines. */
  conceptTag?: string;
  options: Array<{ id: string; label: string; correct: boolean }>;
  feedbackCorrect?: string;
  feedbackIncorrect?: string;
};

export type LessonQuizQuestionOutline = {
  id: string;
  prompt: string;
  /** Required at seed time (§16.8); optional on legacy outlines. */
  conceptTag?: string;
  options: Array<{ id: string; label: string }>;
  correctOptionId: string;
  explanation: string;
};

export type LessonRecoveryItem = {
  id: string;
  prompt: string;
  options: Array<{ id: string; label: string; correct?: boolean }>;
  explanation: string;
};

export type LessonRemediationPool = {
  microExplanation: LessonContentBlock[];
  recoveryItems: LessonRecoveryItem[];
};

export type LessonRewardPresentation = {
  rewardClass:
    | 'concept_read'
    | 'knowledge_check'
    | 'standard_practice'
    | 'project'
    | 'reflection'
    | string;
  arloLine?: string;
  badgeCandidateKey?: string | null;
};

export type LessonRewardOutline = {
  gems?: number;
  coins?: number;
  arloLine?: string;
  badgeId?: string | null;
  badgeLabel?: string | null;
};

export type LessonPlayOutline = {
  objective: string;
  arloPrompt: string;
  suggestedArlo: string[];
  content: LessonContentPage[];
  practice: LessonPracticeOutline;
  /** Empty allowed for practice / mini_project / reflection (§16 / Task 1). */
  quiz: LessonQuizQuestionOutline[];
  reward?: LessonRewardOutline;
  rewardPresentation?: LessonRewardPresentation;
  /** Server-only remediation pools keyed by conceptTag (§16.2). */
  remediation?: Record<string, LessonRemediationPool>;
  /** Default 2 — exposed publicly via adaptive block only. */
  attemptBudgetPerConcept?: number;
};

export const DEFAULT_ATTEMPT_BUDGET_PER_CONCEPT = 2;

export function isPlayOutline(value: unknown): value is LessonPlayOutline {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.objective === 'string' &&
    typeof v.arloPrompt === 'string' &&
    Array.isArray(v.content) &&
    v.content.length > 0 &&
    typeof v.practice === 'object' &&
    v.practice !== null &&
    Array.isArray(v.quiz)
  );
}

/** Seed gate (§16.8): every practice/quiz item must carry conceptTag. */
export function assertConceptTagsPresent(outline: LessonPlayOutline): void {
  if (!outline.practice?.conceptTag?.trim()) {
    throw new Error(
      `Seed validation failed: practice "${outline.practice?.id ?? '?'}" missing conceptTag`,
    );
  }
  for (const q of outline.quiz ?? []) {
    if (!q.conceptTag?.trim()) {
      throw new Error(
        `Seed validation failed: quiz "${q.id}" missing conceptTag`,
      );
    }
  }
}

/** Keys that must never appear on GET /play public body. */
export const PLAY_SECRET_KEYS = [
  'correct',
  'correctOptionId',
  'explanation',
  'feedbackIncorrect',
  'remediation',
  'badgeCandidateKey',
] as const;

export function collectSecretKeyHits(
  value: unknown,
  path = '',
): string[] {
  const hits: string[] = [];
  if (value == null) return hits;
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      hits.push(...collectSecretKeyHits(item, `${path}[${i}]`));
    });
    return hits;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const next = path ? `${path}.${k}` : k;
      if ((PLAY_SECRET_KEYS as readonly string[]).includes(k)) {
        hits.push(next);
      }
      hits.push(...collectSecretKeyHits(v, next));
    }
  }
  return hits;
}
