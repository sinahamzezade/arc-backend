export type UnitsJsonSkill = {
  id: string;
  title: string;
  prerequisites: string[];
  level: number;
};

export const UNIT_ROLES = [
  'foundation',
  'refresher',
  'checkpoint',
  'project',
  'proof',
] as const;

export type UnitRole = (typeof UNIT_ROLES)[number];

export type UnitsJsonUnit = {
  id: string;
  title: string;
  skills_taught: string[];
  prerequisites: string[];
  level: number;
  estimated_minutes: number;
  formats: string[];
  lesson_type: string;
  domain: string;
  stack: string;
  provider?: string | null;
  url?: string | null;
  xp: number;
  content: Record<string, unknown>;
  /** Learner stages this unit serves (defaults to `[level]`). */
  serves_stage?: number[];
  /** foundation | refresher | checkpoint | project | proof (defaults to `foundation`). */
  unit_role?: string;
  /** Coarse profiling skill slug e.g. `html-css` (defaults to skills_taught prefix). */
  profile_skill_slug?: string | null;
  source_template_id?: string | null;
  source_version_id?: string | null;
};

export type UnitsJsonDocument = {
  skills_index: UnitsJsonSkill[];
  units: UnitsJsonUnit[];
  $schema_notes?: string;
};

export function isUnitsJsonDocument(
  value: unknown,
): value is UnitsJsonDocument {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.skills_index) && Array.isArray(v.units);
}
