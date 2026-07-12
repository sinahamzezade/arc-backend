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
  options: Array<{ id: string; label: string; correct: boolean }>;
  feedbackCorrect?: string;
  feedbackIncorrect?: string;
};

export type LessonQuizQuestionOutline = {
  id: string;
  prompt: string;
  options: Array<{ id: string; label: string }>;
  correctOptionId: string;
  explanation: string;
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
  quiz: LessonQuizQuestionOutline[];
  reward?: LessonRewardOutline;
};

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
    Array.isArray(v.quiz) &&
    v.quiz.length > 0
  );
}
