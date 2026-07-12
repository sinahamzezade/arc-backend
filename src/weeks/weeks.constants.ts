export const DAY_LABELS = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
] as const;

export const DAY_FULL = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export type HomeDayStatus = 'done' | 'empty';
export type PulseDayStatus = HomeDayStatus | 'today';

export function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function envFloat(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

export function lockRewardXpDefault(): number {
  return envInt('WEEKS_LOCK_REWARD_XP', 50);
}

export function lockRewardGemsDefault(): number {
  return envInt('WEEKS_LOCK_REWARD_GEMS', 8);
}

export function sealHoursRatio(): number {
  return envFloat('WEEKS_SEAL_HOURS_RATIO', 0.8);
}

export function replanMaxPerWeek(): number {
  return envInt('WEEKS_REPLAN_MAX_PER_WEEK', 2);
}

export function streakResetOnMiss(): boolean {
  return envBool('WEEKS_STREAK_RESET_ON_MISS', false);
}

export function tzFallback(): string {
  return process.env.WEEKS_TZ_FALLBACK?.trim() || 'UTC';
}
