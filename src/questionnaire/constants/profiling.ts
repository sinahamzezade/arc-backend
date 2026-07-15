/** Profiling model version stored on each learner profile snapshot. */
export const PROFILING_MODEL_VERSION = 'learner_profile_v1';

export const EXPOSURE_LEVELS = [
  'heard_of',
  'follow_with_help',
  'use_independently',
  'use_professionally',
] as const;

export type ExposureLevel = (typeof EXPOSURE_LEVELS)[number];

export const EXPOSURE_SCORES: Record<ExposureLevel, number> = {
  heard_of: 15,
  follow_with_help: 35,
  use_independently: 65,
  use_professionally: 85,
};

export const SELF_STAGE_SCORES: Record<number, number> = {
  1: 10,
  2: 30,
  3: 50,
  4: 70,
  5: 90,
};

export const USE_FREQUENCY_SCORES: Record<string, number> = {
  never_used: 0,
  personal_projects: 25,
  studied_before: 40,
  work_sometimes: 65,
  work_regularly: 85,
};

export const WEEKLY_HOURS_MINUTES: Record<string, number> = {
  'lt-3': 120,
  '3-5': 240,
  '5-8': 390,
  '8-12': 600,
  'gt-12': 840,
};

export const SESSION_MINUTE_OPTIONS = [25, 45, 60, 90] as const;

export const TARGET_OUTCOME_STAGE: Record<string, number> = {
  understand_basics: 2,
  use_independently: 3,
  build_advanced: 4,
  job_ready: 5,
};

export const CONFIDENCE_CALIBRATION: Record<string, number> = {
  starting: -3,
  beginner: -1,
  somewhat: 0,
  confident: 2,
  very: 4,
};

/** Style token → pool format bias key used by roadmap selector. */
export const STYLE_TO_FORMAT: Record<string, string> = {
  doing: 'doing',
  projects: 'doing',
  videos: 'videos',
  video: 'videos',
  reading: 'reading',
  quizzes: 'quiz',
  quiz: 'quiz',
  guides: 'guides',
  guided_examples: 'guides',
  audio: 'audio',
  hands_on: 'doing',
};

export const CAPACITY_SUSTAINABILITY = 0.8;
