import type { Unit } from '../content-pool/entities/unit.entity';
import type {
  OrchestratorDraft,
  OrchestratorPhaseDraft,
} from './roadmap-units-orchestrator.prompt';
import { flattenOrchestratorUnitIds } from './roadmap-units-orchestrator.schema';

export type SkillAction = 'foundation' | 'refresher' | 'checkpoint' | 'omit';

export type ValidateRepairInput = {
  draft: OrchestratorDraft;
  /** Units the LLM may choose from (id → unit). */
  allowList: Map<string, Unit>;
  requiredGap: Set<string>;
  optionalGap: Set<string>;
  /** Gap skills in topo order (required then optional already mixed by topo). */
  orderedGapSkillIds: string[];
  skillPlans: Map<string, { action: SkillAction; entryStage: number }>;
  budgetMinutes: number;
  /** Primary skill title lookup. */
  skillTitleById: Map<string, string>;
};

export type ValidateRepairResult = {
  draft: OrchestratorDraft;
  /** Flat ordered unit ids after repair. */
  unitIds: string[];
  repaired: boolean;
  repairReasons: string[];
};

/**
 * Server validate + repair for AI unit orchestration.
 * Never invents ids; may insert from allow-list, reorder, trim optionals.
 * Throws when required skills cannot be covered or required alone exceeds budget.
 */
export function validateAndRepairOrchestratorDraft(
  input: ValidateRepairInput,
): ValidateRepairResult {
  const reasons: string[] = [];
  let repaired = false;

  // 1. Drop unknown / not-in-allow-list ids; dedupe preserving order.
  const rawIds = flattenOrchestratorUnitIds(input.draft);
  const filtered: string[] = [];
  const seen = new Set<string>();
  for (const id of rawIds) {
    if (!input.allowList.has(id)) {
      repaired = true;
      reasons.push(`dropped_unknown:${id}`);
      continue;
    }
    if (seen.has(id)) {
      repaired = true;
      reasons.push(`dropped_dup:${id}`);
      continue;
    }
    seen.add(id);
    filtered.push(id);
  }

  // 2. Cover every required skill — insert cheapest allow-list unit if missing.
  let unitIds = [...filtered];
  for (const skillId of input.requiredGap) {
    if (coversSkill(unitIds, input.allowList, skillId)) continue;
    const inserted = pickRepairUnit(input, skillId, new Set(unitIds));
    if (!inserted) {
      throw new Error(`orchestrator_cannot_cover_required:${skillId}`);
    }
    unitIds.push(inserted);
    repaired = true;
    reasons.push(`inserted_required:${skillId}:${inserted}`);
  }

  // 3. Protect sole checkpoint/proof for required skills.
  for (const skillId of input.requiredGap) {
    const sole = findSoleCheckpointOrProof(input.allowList, skillId);
    if (!sole) continue;
    if (unitIds.includes(sole.id)) continue;
    // Only force-include when selected set has no checkpoint/proof for skill.
    const hasProof = unitIds.some((id) => {
      const u = input.allowList.get(id);
      return (
        u &&
        (u.skillsTaught ?? []).includes(skillId) &&
        (u.unitRole === 'checkpoint' || u.unitRole === 'proof')
      );
    });
    if (hasProof) continue;
    unitIds.push(sole.id);
    repaired = true;
    reasons.push(`inserted_sole_checkpoint:${skillId}:${sole.id}`);
  }

  // 4. Reorder for topo skill coverage + unit prerequisites.
  const reordered = reorderForPrereqs(unitIds, input);
  if (!sameOrder(unitIds, reordered)) {
    repaired = true;
    reasons.push('reordered_prereqs');
    unitIds = reordered;
  }

  // 5. Budget trim — drop trailing optionals (never sole required coverage).
  const trimmed = trimToBudget(unitIds, input);
  if (trimmed.ids.length !== unitIds.length) {
    repaired = true;
    reasons.push(...trimmed.reasons);
    unitIds = trimmed.ids;
  }

  // Ensure required still covered after trim.
  for (const skillId of input.requiredGap) {
    if (!coversSkill(unitIds, input.allowList, skillId)) {
      throw new Error(`orchestrator_required_lost_after_trim:${skillId}`);
    }
  }

  const draft = rebuildPhases(input.draft, unitIds);
  return { draft, unitIds, repaired, repairReasons: reasons };
}

function coversSkill(
  unitIds: string[],
  allowList: Map<string, Unit>,
  skillId: string,
): boolean {
  return unitIds.some((id) =>
    (allowList.get(id)?.skillsTaught ?? []).includes(skillId),
  );
}

function pickRepairUnit(
  input: ValidateRepairInput,
  skillId: string,
  already: Set<string>,
): string | null {
  const plan = input.skillPlans.get(skillId);
  const preferredRole =
    plan?.action === 'checkpoint'
      ? 'checkpoint'
      : plan?.action === 'refresher'
        ? 'refresher'
        : null;

  const candidates = [...input.allowList.values()]
    .filter(
      (u) =>
        !already.has(u.id) && (u.skillsTaught ?? []).includes(skillId),
    )
    .sort((a, b) => {
      const aRole =
        preferredRole && a.unitRole === preferredRole
          ? 0
          : a.unitRole === 'checkpoint' || a.unitRole === 'proof'
            ? 1
            : 2;
      const bRole =
        preferredRole && b.unitRole === preferredRole
          ? 0
          : b.unitRole === 'checkpoint' || b.unitRole === 'proof'
            ? 1
            : 2;
      if (aRole !== bRole) return aRole - bRole;
      if (a.estimatedMinutes !== b.estimatedMinutes) {
        return a.estimatedMinutes - b.estimatedMinutes;
      }
      return a.id.localeCompare(b.id);
    });

  return candidates[0]?.id ?? null;
}

function findSoleCheckpointOrProof(
  allowList: Map<string, Unit>,
  skillId: string,
): Unit | null {
  const proofs = [...allowList.values()].filter(
    (u) =>
      (u.skillsTaught ?? []).includes(skillId) &&
      (u.unitRole === 'checkpoint' || u.unitRole === 'proof'),
  );
  return proofs.length === 1 ? proofs[0]! : null;
}

/**
 * Stable reorder: walk topo gap skills; emit selected units whose primary
 * uncovered skill is next; append leftovers that only teach optional/known.
 * Also delay units whose skill prerequisites are not yet covered.
 */
function reorderForPrereqs(
  unitIds: string[],
  input: ValidateRepairInput,
): string[] {
  const remaining = new Set(unitIds);
  const out: string[] = [];
  const coveredSkills = new Set<string>();

  const tryEmit = (id: string): boolean => {
    const unit = input.allowList.get(id);
    if (!unit) return false;
    const prereqs = unit.prerequisites ?? [];
    const ready = prereqs.every(
      (p) =>
        coveredSkills.has(p) ||
        (unit.skillsTaught ?? []).includes(p) ||
        (!input.requiredGap.has(p) && !input.optionalGap.has(p)),
    );
    if (!ready) return false;
    out.push(id);
    remaining.delete(id);
    for (const sk of unit.skillsTaught ?? []) coveredSkills.add(sk);
    return true;
  };

  // Pass 1: for each topo skill, emit units that teach it (prefer primary).
  for (const skillId of input.orderedGapSkillIds) {
    const teaching = [...remaining].filter((id) =>
      (input.allowList.get(id)?.skillsTaught ?? []).includes(skillId),
    );
    // Prefer units whose earliest gap skill is this one.
    teaching.sort((a, b) => {
      const pa = primarySkill(input.allowList.get(a)!, input);
      const pb = primarySkill(input.allowList.get(b)!, input);
      if (pa === skillId && pb !== skillId) return -1;
      if (pb === skillId && pa !== skillId) return 1;
      return a.localeCompare(b);
    });
    for (const id of teaching) {
      if (!remaining.has(id)) continue;
      tryEmit(id);
    }
  }

  // Pass 2: drain leftovers (prereq-blocked earlier may now be ready).
  let progress = true;
  while (remaining.size && progress) {
    progress = false;
    for (const id of [...remaining]) {
      if (tryEmit(id)) progress = true;
    }
  }

  // Pass 3: force append any still blocked (better than drop).
  for (const id of [...remaining]) {
    out.push(id);
    remaining.delete(id);
  }

  return out;
}

function primarySkill(
  unit: Unit,
  input: ValidateRepairInput,
): string | null {
  for (const skillId of input.orderedGapSkillIds) {
    if ((unit.skillsTaught ?? []).includes(skillId)) return skillId;
  }
  return (unit.skillsTaught ?? [])[0] ?? null;
}

function trimToBudget(
  unitIds: string[],
  input: ValidateRepairInput,
): { ids: string[]; reasons: string[] } {
  const reasons: string[] = [];
  const minutesOf = (id: string) =>
    input.allowList.get(id)?.estimatedMinutes ?? 0;

  const requiredMinutes = () => {
    // Floor: cheapest covering unit per required skill still in set.
    let floor = 0;
    for (const skillId of input.requiredGap) {
      const covering = unitIds
        .map((id) => input.allowList.get(id))
        .filter(
          (u): u is Unit =>
            !!u && (u.skillsTaught ?? []).includes(skillId),
        );
      if (!covering.length) continue;
      floor += Math.min(...covering.map((u) => u.estimatedMinutes));
    }
    return floor;
  };

  let total = unitIds.reduce((s, id) => s + minutesOf(id), 0);
  if (total <= input.budgetMinutes) return { ids: unitIds, reasons };

  const floor = requiredMinutes();
  if (floor > input.budgetMinutes) {
    throw new Error('orchestrator_required_budget_exceeded');
  }

  const ids = [...unitIds];
  // Drop from the end if optional (unit teaches no required skill exclusively
  // as sole coverage).
  for (let i = ids.length - 1; i >= 0 && total > input.budgetMinutes; i--) {
    const id = ids[i]!;
    const unit = input.allowList.get(id);
    if (!unit) continue;

    const teachesRequired = (unit.skillsTaught ?? []).some((sk) =>
      input.requiredGap.has(sk),
    );
    if (teachesRequired) {
      // Only drop if every required skill it teaches still covered elsewhere.
      const soleFor = (unit.skillsTaught ?? []).filter((sk) => {
        if (!input.requiredGap.has(sk)) return false;
        return (
          ids.filter(
            (other) =>
              other !== id &&
              (input.allowList.get(other)?.skillsTaught ?? []).includes(sk),
          ).length === 0
        );
      });
      if (soleFor.length) continue;

      // Never drop sole checkpoint/proof for a required skill.
      if (
        (unit.unitRole === 'checkpoint' || unit.unitRole === 'proof') &&
        (unit.skillsTaught ?? []).some((sk) => input.requiredGap.has(sk))
      ) {
        const sole = findSoleCheckpointOrProof(input.allowList, 
          (unit.skillsTaught ?? []).find((sk) => input.requiredGap.has(sk))!,
        );
        if (sole?.id === id) continue;
      }
    }

    total -= minutesOf(id);
    ids.splice(i, 1);
    reasons.push(`trimmed_budget:${id}`);
  }

  if (total > input.budgetMinutes) {
    throw new Error('orchestrator_required_budget_exceeded');
  }

  return { ids, reasons };
}

function rebuildPhases(
  original: OrchestratorDraft,
  unitIds: string[],
): OrchestratorDraft {
  const assigned = new Set<string>();
  const phases: OrchestratorPhaseDraft[] = [];

  for (const phase of original.phases) {
    const kept = phase.unitIds.filter(
      (id) => unitIds.includes(id) && !assigned.has(id),
    );
    for (const id of kept) assigned.add(id);
    if (kept.length) {
      phases.push({ ...phase, unitIds: kept });
    }
  }

  const orphans = unitIds.filter((id) => !assigned.has(id));
  if (orphans.length) {
    if (phases.length) {
      const last = phases[phases.length - 1]!;
      last.unitIds = [...last.unitIds, ...orphans];
    } else {
      phases.push({
        key: 'path',
        title: 'Your path',
        unitIds: orphans,
      });
    }
  }

  // Ensure 1-6 phases; merge if somehow empty (shouldn't).
  if (!phases.length) {
    phases.push({ key: 'path', title: 'Your path', unitIds: [...unitIds] });
  }

  return {
    title: original.title,
    description: original.description,
    why: original.why,
    phases: phases.slice(0, 6),
  };
}

function sameOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}
