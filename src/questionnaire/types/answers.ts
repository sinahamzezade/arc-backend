export type ScheduleAnswer = {
  days: string[];
  times: string[];
};

/** Dynamic questionnaire payload keyed by step fieldKey (+ `${key}Other`). */
export type QuestionnaireAnswers = Record<string, unknown>;

export function isScheduleAnswer(value: unknown): value is ScheduleAnswer {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return Array.isArray(row.days) && Array.isArray(row.times);
}

export function asStringArray(
  answers: QuestionnaireAnswers,
  key: string,
): string[] {
  const value = answers[key];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export function asString(answers: QuestionnaireAnswers, key: string): string {
  const value = answers[key];
  return typeof value === 'string' ? value : '';
}

export function asOptionalString(
  answers: QuestionnaireAnswers,
  key: string,
): string | undefined {
  const value = answers[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function asSchedule(
  answers: QuestionnaireAnswers,
  key = 'schedule',
): ScheduleAnswer {
  const value = answers[key];
  if (isScheduleAnswer(value)) {
    return {
      days: value.days.filter((d): d is string => typeof d === 'string'),
      times: value.times.filter((t): t is string => typeof t === 'string'),
    };
  }
  for (const candidate of Object.values(answers)) {
    if (isScheduleAnswer(candidate)) {
      return {
        days: candidate.days.filter((d): d is string => typeof d === 'string'),
        times: candidate.times.filter(
          (t): t is string => typeof t === 'string',
        ),
      };
    }
  }
  return { days: [], times: [] };
}

export const emptyQuestionnaireAnswers = (): QuestionnaireAnswers => ({});
