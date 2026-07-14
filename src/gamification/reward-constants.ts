/** Bump when lesson reward calculator rules change. */
export const REWARD_RULE_VERSION = 'lesson-reward-v2';

/** Bump when play outline jsonb schema changes. */
export const CONTENT_SCHEMA_VERSION = 1;

export const OUTBOX_LESSON_COMPLETED = 'lesson.completed.v1';
export const OUTBOX_LESSON_REMEDIATION = 'lesson.remediation.v1';
export const OUTBOX_REWARD_GRANTED = 'reward.granted.v1';
export const OUTBOX_GAMIFICATION_REWARD =
  'gamification.reward_granted';
export const OUTBOX_WEEK_SEALED = 'week.sealed.v1';
export const OUTBOX_SCHEDULE_REPLANNED = 'schedule.replanned.v1';
export const OUTBOX_SCHEDULE_GENERATED = 'schedule.generated.v1';

export const SEAL_REWARD_RULE_KEY = 'week-seal-v1';
