import type { InAppLessonContent } from './inapp-content.mapper';

export type SeedResource = {
  slug: string;
  title: string;
  url: string;
  provider: string;
  resourceType: string;
  skillTags?: string[];
  techStackSlugs?: string[];
};

export type SeedLesson = {
  slug: string;
  title: string;
  missionNameTemplate?: string;
  lessonType:
    'video' | 'reading' | 'practice' | 'quiz' | 'reflection' | 'mini_project';
  estimatedMinutes: number;
  xpReward: number;
  learningStyleTags: string[];
  resourceSlug?: string;
  orderHint: number;
  /** In-app embedded body (frontend-inapp packs). */
  content?: InAppLessonContent;
};

export type SeedSkill = {
  slug: string;
  title: string;
  description?: string;
  orderHint: number;
  estimatedHours: number;
  tags: string[];
  prereqSlugs?: string[];
  lessons: SeedLesson[];
};

export type SeedStack = {
  slug: string;
  name: string;
  category: string;
  description: string;
  skills: SeedSkill[];
};

export type SeedRecipePhase = {
  key: string;
  title: string;
  tech_stack_slugs: string[];
  required: boolean;
  include_if_confidence_gte?: string;
};

export type SeedRecipe = {
  targetRoleSlug: string;
  title: string;
  summary: string;
  defaultTimelineWeeks: number;
  phases: SeedRecipePhase[];
};

export type CatalogSeed = {
  resources: SeedResource[];
  stacks: SeedStack[];
  recipes: SeedRecipe[];
};
