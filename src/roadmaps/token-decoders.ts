/** Schema v1 token decoders — keep in sync with Question Engine seed. */

const STUDY_HOURS: Record<string, number> = {
  'lt-3': 2,
  '3-5': 4,
  '5-8': 6.5,
  '8-12': 10,
  'gt-12': 14,
};

const DEADLINE_WEEKS: Record<string, number | null> = {
  '1-3': 8,
  '3-6': 16,
  '6-12': 24,
  '12+': 40,
  none: null,
};

const CONFIDENCE_RANK: Record<string, number> = {
  starting: 0,
  beginner: 1,
  somewhat: 2,
  confident: 3,
  very: 4,
};

export function decodeWeeklyHours(token: string | null | undefined): number {
  if (!token) return 6.5;
  return STUDY_HOURS[token] ?? 6.5;
}

export function decodeTimelineWeeks(
  token: string | null | undefined,
  recipeDefaultWeeks: number,
): number {
  if (!token) return recipeDefaultWeeks;
  const mapped = DEADLINE_WEEKS[token];
  if (mapped === null || mapped === undefined) {
    return recipeDefaultWeeks;
  }
  return Math.min(mapped, recipeDefaultWeeks * 2);
}

export function confidenceMeets(
  userConfidence: string | null | undefined,
  required: string | undefined,
): boolean {
  if (!required) return true;
  const userRank = CONFIDENCE_RANK[userConfidence ?? 'starting'] ?? 0;
  const needRank = CONFIDENCE_RANK[required] ?? 0;
  return userRank >= needRank;
}

export function budgetMinutes(
  hoursPerWeek: number,
  timelineWeeks: number,
  safetyFactor = 0.85,
): number {
  return Math.round(hoursPerWeek * timelineWeeks * 60 * safetyFactor);
}
