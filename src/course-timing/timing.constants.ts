/** Course Timing constants — aligned with course_timing.md */

export const CAPACITY_SAFETY_FACTOR = 0.85;
export const MIN_SESSION_MINUTES = 10;
export const PREFERRED_SESSION_MIN = 25;
export const PREFERRED_SESSION_MAX = 45;
export const MAX_DEEP_WORK_MINUTES = 90;
export const ACTIVE_WINDOW_WEEKS = 2;
export const WINDOW_EXPAND_THRESHOLD = 0.5;
export const MIN_SAFE_WEEKLY_MINUTES = 60;
export const REMINDER_LEAD_MINUTES_DEFAULT = 30;
export const MISSED_AFTER_MINUTES = 60;
export const TZ_CHANGE_COOLDOWN_DAYS = 30;
export const MIN_ACTIVE_DAYS_FOR_EWMA = 7;

export const TIME_WINDOW_START: Record<string, { hour: number; minute: number }> =
  {
    morning: { hour: 9, minute: 0 },
    afternoon: { hour: 14, minute: 0 },
    evening: { hour: 18, minute: 0 },
    'late-night': { hour: 22, minute: 0 },
  };

export enum CommitmentStatus {
  Active = 'active',
  Paused = 'paused',
  Archived = 'archived',
}

export enum PaceState {
  Ahead = 'ahead',
  OnTrack = 'on_track',
  SlightlyBehind = 'slightly_behind',
  AtRisk = 'at_risk',
  Paused = 'paused',
}

export enum FeasibilityState {
  Comfortable = 'comfortable',
  Feasible = 'feasible',
  Compressed = 'compressed',
  Unrealistic = 'unrealistic',
}

export enum ScheduleSlotStatus {
  Planned = 'planned',
  Started = 'started',
  Completed = 'completed',
  Missed = 'missed',
  Moved = 'moved',
  Cancelled = 'cancelled',
}

export enum ScheduleSlotSource {
  Questionnaire = 'questionnaire',
  Replan = 'replan',
  Coach = 'coach',
  User = 'user',
}

export enum ReminderStatus {
  Pending = 'pending',
  Scheduled = 'scheduled',
  Sent = 'sent',
  Cancelled = 'cancelled',
  Failed = 'failed',
}

export enum ScheduleChangeActor {
  User = 'user',
  System = 'system',
  Coach = 'coach',
}

export function feasibilityFromRatio(ratio: number): FeasibilityState {
  if (ratio <= 0.85) return FeasibilityState.Comfortable;
  if (ratio <= 1.0) return FeasibilityState.Feasible;
  if (ratio <= 1.2) return FeasibilityState.Compressed;
  return FeasibilityState.Unrealistic;
}
