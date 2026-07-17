/** Bump when lesson reward calculator rules change. */
export const REWARD_RULE_VERSION = 'lesson-reward-v3';

/** Bump when play outline jsonb schema changes. */
export const CONTENT_SCHEMA_VERSION = 1;

export const OUTBOX_LESSON_COMPLETED = 'lesson.completed.v1';
export const OUTBOX_LESSON_REMEDIATION = 'lesson.remediation.v1';
export const OUTBOX_LESSON_ACTIVE_RESOLVED = 'lesson.active_block_resolved.v1';
export const OUTBOX_REWARD_GRANTED = 'reward.granted.v1';
export const OUTBOX_REWARD_VARIABLE_ROLL = 'reward.variable_roll_applied.v1';
export const OUTBOX_COACH_TONE_SELECTED = 'coach.tone_selected.v1';
export const OUTBOX_LIVE_CONTEXT_SERVED = 'content.live_context_served.v1';
export const OUTBOX_LIVE_CONTEXT_EXPIRED_SKIP =
  'content.live_context_expired_skip.v1';
export const OUTBOX_CROSS_TRACK_SURFACED = 'content.cross_track_unit_surfaced.v1';
export const OUTBOX_CROSS_TRACK_COMPLETED =
  'content.cross_track_unit_completed.v1';
export const OUTBOX_GAMIFICATION_REWARD =
  'gamification.reward_granted';
export const OUTBOX_WEEK_SEALED = 'week.sealed.v1';
export const OUTBOX_SCHEDULE_REPLANNED = 'schedule.replanned.v1';
export const OUTBOX_SCHEDULE_GENERATED = 'schedule.generated.v1';
export const OUTBOX_ROADMAP_COMPLETED = 'roadmap.completed.v1';
export const OUTBOX_ROADMAP_REENROLLMENT_STARTED =
  'roadmap.reenrollment_started.v1';

export const SEAL_REWARD_RULE_KEY = 'week-seal-v1';
export const ROADMAP_COMPLETE_REWARD_RULE_KEY = 'roadmap-complete-v1';
