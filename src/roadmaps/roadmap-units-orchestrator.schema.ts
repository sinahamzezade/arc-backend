import type {
  OrchestratorDraft,
  OrchestratorPhaseDraft,
} from './roadmap-units-orchestrator.prompt';

/**
 * Parse orchestrator JSON. phases[].units may be compact indices (n) or unit ids.
 * Maps indices → unit ids via unitIdByIndex.
 */
export function parseUnitsOrchestratorDraft(
  raw: unknown,
  unitIdByIndex: Map<number, string>,
  allowListIds: Set<string>,
): OrchestratorDraft {
  if (!raw || typeof raw !== 'object') {
    throw new Error('orchestrator_draft_not_object');
  }
  const row = raw as Record<string, unknown>;

  const title =
    typeof row.title === 'string' && row.title.trim()
      ? row.title.trim().slice(0, 120)
      : 'Your Learning Path';
  const description =
    typeof row.desc === 'string'
      ? row.desc.trim().slice(0, 400)
      : typeof row.description === 'string'
        ? row.description.trim().slice(0, 400)
        : '';
  const why = typeof row.why === 'string' ? row.why.trim().slice(0, 300) : '';

  const phasesRaw = Array.isArray(row.phases) ? row.phases : [];
  const phases: OrchestratorPhaseDraft[] = [];
  const usedKeys = new Set<string>();
  const usedUnits = new Set<string>();

  for (const item of phasesRaw) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;

    let key =
      typeof p.k === 'string' ? p.k : typeof p.key === 'string' ? p.key : '';
    key = key
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    if (!key) key = `phase-${phases.length + 1}`;
    if (usedKeys.has(key)) key = `${key}-${phases.length + 1}`;
    usedKeys.add(key);

    const phaseTitle =
      typeof p.t === 'string' && p.t.trim()
        ? p.t.trim().slice(0, 80)
        : typeof p.title === 'string' && p.title.trim()
          ? p.title.trim().slice(0, 80)
          : key;

    const rawUnits = Array.isArray(p.units)
      ? p.units
      : Array.isArray(p.unit_ids)
        ? p.unit_ids
        : Array.isArray(p.lessons)
          ? p.lessons
          : [];

    const unitIds: string[] = [];
    for (const entry of rawUnits) {
      let id: string | null = null;
      if (typeof entry === 'number' && Number.isFinite(entry)) {
        id = unitIdByIndex.get(Math.trunc(entry)) ?? null;
      } else if (typeof entry === 'string') {
        const trimmed = entry.trim();
        if (allowListIds.has(trimmed)) {
          id = trimmed;
        } else {
          const asNum = Number(trimmed);
          if (Number.isFinite(asNum)) {
            id = unitIdByIndex.get(Math.trunc(asNum)) ?? null;
          }
        }
      }
      if (!id || usedUnits.has(id) || !allowListIds.has(id)) continue;
      usedUnits.add(id);
      unitIds.push(id);
    }
    if (!unitIds.length) continue;
    phases.push({ key, title: phaseTitle, unitIds });
  }

  if (!phases.length) {
    throw new Error('orchestrator_no_phases');
  }

  const maxPhases = 6;
  const minPhases = Math.min(3, Math.max(1, phases.length));
  if (phases.length > maxPhases) {
    // Soft: keep first 6 non-empty (already non-empty).
    phases.splice(maxPhases);
  }
  if (phases.length < minPhases && phases.length === 0) {
    throw new Error(`orchestrator_phase_count_${phases.length}`);
  }

  return { title, description, why, phases };
}

/** Flatten phase unit ids in order (deduped). */
export function flattenOrchestratorUnitIds(draft: OrchestratorDraft): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const phase of draft.phases) {
    for (const id of phase.unitIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
