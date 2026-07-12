import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
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

type RawCatalogFile = {
  resources?: SeedResource[];
  stacks?: SeedStack[];
  recipes?: SeedRecipe[];
  contentModel?: unknown;
};

function loadOne(filename: string): CatalogSeed {
  const path = join(process.cwd(), 'course', filename);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as RawCatalogFile;
  if (!raw?.stacks?.length || !raw?.recipes?.length) {
    throw new Error(`Invalid catalog seed at ${path}`);
  }
  return {
    resources: raw.resources ?? [],
    stacks: raw.stacks,
    recipes: raw.recipes,
  };
}

/** Merge all `course/*-learning-data.json` (slug-keyed, later files win on collide). */
export function loadCatalogSeed(): CatalogSeed {
  const dir = join(process.cwd(), 'course');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('-learning-data.json'))
    .sort();
  if (!files.length) {
    throw new Error(`No *-learning-data.json in ${dir}`);
  }

  const resources = new Map<string, SeedResource>();
  const stacks = new Map<string, SeedStack>();
  const recipes = new Map<string, SeedRecipe>();

  for (const file of files) {
    const part = loadOne(file);
    for (const r of part.resources) resources.set(r.slug, r);
    for (const s of part.stacks) stacks.set(s.slug, s);
    for (const r of part.recipes) recipes.set(r.targetRoleSlug, r);
  }

  return {
    resources: [...resources.values()],
    stacks: [...stacks.values()],
    recipes: [...recipes.values()],
  };
}

export const CATALOG_SEED: CatalogSeed = loadCatalogSeed();
