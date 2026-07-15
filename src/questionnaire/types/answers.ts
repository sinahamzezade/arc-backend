export type ScheduleAnswer = {
  days: string[];
  times: string[];
  timezone?: string;
};

export type SkillEvidenceAnswer = {
  skillSlug: string;
  exposureLevel: string;
};

export type TrackSelectionAnswer = {
  primary: string;
  secondary: string[];
};

/** Dynamic questionnaire payload keyed by step fieldKey (+ `${key}Other`). */
export type QuestionnaireAnswers = Record<string, unknown>;

export function isScheduleAnswer(value: unknown): value is ScheduleAnswer {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return Array.isArray(row.days) && Array.isArray(row.times);
}

export function isSkillEvidenceAnswer(
  value: unknown,
): value is SkillEvidenceAnswer {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.skillSlug === 'string' && typeof row.exposureLevel === 'string'
  );
}

export function isTrackSelectionAnswer(
  value: unknown,
): value is TrackSelectionAnswer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.primary === 'string' && Array.isArray(row.secondary);
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
      timezone:
        typeof value.timezone === 'string' && value.timezone.trim()
          ? value.timezone.trim()
          : undefined,
    };
  }
  for (const candidate of Object.values(answers)) {
    if (isScheduleAnswer(candidate)) {
      return {
        days: candidate.days.filter((d): d is string => typeof d === 'string'),
        times: candidate.times.filter(
          (t): t is string => typeof t === 'string',
        ),
        timezone:
          typeof candidate.timezone === 'string' && candidate.timezone.trim()
            ? candidate.timezone.trim()
            : undefined,
      };
    }
  }
  return { days: [], times: [] };
}

export function asSkillEvidence(
  answers: QuestionnaireAnswers,
  key = 'skills',
): SkillEvidenceAnswer[] {
  const value = answers[key];
  if (!Array.isArray(value)) {
    // Legacy flat skill list → heard_of
    if (Array.isArray(value) === false && typeof value === 'undefined') {
      const legacy = asStringArray(answers, key).filter((s) => s !== 'none');
      return legacy.map((skillSlug) => ({
        skillSlug,
        exposureLevel: 'heard_of',
      }));
    }
    return [];
  }
  if (value.every((item) => typeof item === 'string')) {
    return (value as string[])
      .filter((s) => s && s !== 'none')
      .map((skillSlug) => ({ skillSlug, exposureLevel: 'heard_of' }));
  }
  return value.filter(isSkillEvidenceAnswer).map((item) => ({
    skillSlug: item.skillSlug.trim(),
    exposureLevel: item.exposureLevel.trim(),
  }));
}

export function asTrackSelection(
  answers: QuestionnaireAnswers,
  key = 'goal',
): TrackSelectionAnswer {
  const value = answers[key];
  if (isTrackSelectionAnswer(value)) {
    return {
      primary: value.primary.trim(),
      secondary: value.secondary
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }
  const roles = asStringArray(answers, key);
  return {
    primary: roles[0] ?? '',
    secondary: roles.slice(1),
  };
}

export const emptyQuestionnaireAnswers = (): QuestionnaireAnswers => ({});
