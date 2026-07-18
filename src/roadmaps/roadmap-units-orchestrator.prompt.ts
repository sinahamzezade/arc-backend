/** Units-pool AI orchestrator — proposes which units exist and their order. */

export const ROADMAP_UNITS_ORCHESTRATOR_PROMPT_VERSION =
  'roadmap_units_orchestrator_v1';

export type OrchestratorCatalogUnit = {
  /** Compact index into allow-list. */
  n: number;
  id: string;
  t: string;
  m: number;
  lt: string;
  role: string;
  sk: string[];
  lvl: number;
  req: boolean;
};

export type OrchestratorLearnerPacket = {
  roles: string[];
  known: string[];
  required: string[];
  optional: string[];
  styles: string[];
  hours: number;
  weeks: number;
  budget: number;
  seed: number;
  goal: string;
  skillPlans: Array<{ skill: string; action: string; entry: number }>;
};

export type OrchestratorPhaseDraft = {
  key: string;
  title: string;
  unitIds: string[];
};

export type OrchestratorDraft = {
  title: string;
  description: string;
  why: string;
  phases: OrchestratorPhaseDraft[];
};

export function buildUnitsOrchestratorSystemPrompt(): string {
  return [
    'Arlo personal roadmap orchestrator for a units content pool.',
    'YOU decide which units to INCLUDE and their EXACT ORDER for this learner.',
    'Return JSON only:',
    '{"title":string,"desc":string,"why":string,"phases":[{"k":string,"t":string,"units":[n,...]}]}',
    'Hard rules:',
    '- phases[].units = unit indices (n) from cat.units ONLY. Never invent ids.',
    '- Select a SUBSET that fits budget (sum minutes ≈ u.budget). Target 8-40 units.',
    '- Cover EVERY skill in u.required with ≥1 unit whose sk includes that skill.',
    '- Prefer unit.role matching skillPlans.action (checkpoint/refresher/foundation).',
    '- Skip units only teaching u.known skills when alternatives exist.',
    '- Order beginner→advanced; respect skill dependency implied by catalog order.',
    '- Vary lesson types (lt) — avoid long runs of the same type.',
    '- 3-6 phases with personal titles. why = one sentence for this order.',
    '- Use u.seed to vary choices across learners.',
    '- Compact keys only. No markdown.',
  ].join(' ');
}

export function buildUnitsOrchestratorUserPrompt(input: {
  learner: OrchestratorLearnerPacket;
  units: OrchestratorCatalogUnit[];
  recipeTitle: string;
  roleSlug: string;
}): string {
  return JSON.stringify({
    task: 'select_and_order_units',
    u: input.learner,
    role: input.roleSlug,
    recipe: input.recipeTitle,
    cat: { units: input.units },
    forbid:
      'Do not emit every catalog unit. Do not invent indices. Cover all required skills.',
  });
}
