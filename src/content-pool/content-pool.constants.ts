/** Publication lifecycle for pool content versions. */
export enum ContentPublicationStatus {
  Draft = 'draft',
  Review = 'review',
  Published = 'published',
  Retired = 'retired',
  Blocked = 'blocked',
}

export const CONTENT_SAFETY_FACTOR = 0.85;

export const BATTLE_POOL_MIN_MULTIPLIER = 5;

export const SELECTION_WEIGHTS = {
  roleFit: 0.3,
  skillGapFit: 0.25,
  prerequisiteReadiness: 0.15,
  learningStyleFit: 0.1,
  timeFit: 0.1,
  qualityScore: 0.1,
} as const;

export type QuestionAllowedContext = 'lesson' | 'assessment' | 'battle';

export type LessonSchedulingTag = 'short' | 'deep_work' | 'commute_safe';
