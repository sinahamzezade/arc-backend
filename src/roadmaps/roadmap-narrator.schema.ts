import type {
  NarratorDraft,
  NarratorPhaseDraft,
} from './roadmap-narrator.prompt';

/**
 * Parse + validate narrator output (same hand-rolled pattern as
 * roadmap-llm-planner.schema.ts). Throws on any structural violation so the
 * caller can run the deterministic repair path.
 *
 * Hard invariants:
 * - phases are contiguous slices of [0..lessonCount)
 * - every index appears exactly once across all phases
 * - 3-6 phases (unless lessonCount forces fewer)
 */
export function parseRoadmapNarratorDraft(
  raw: unknown,
  lessonCount: number,
): NarratorDraft {
  if (!raw || typeof raw !== 'object') {
    throw new Error('narrator_draft_not_object');
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
  const phases: NarratorPhaseDraft[] = [];
  const usedKeys = new Set<string>();

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

    const rawLessons = Array.isArray(p.lessons) ? p.lessons : [];
    const lessonIndices: number[] = [];
    for (const entry of rawLessons) {
      const n =
        typeof entry === 'number'
          ? entry
          : typeof entry === 'string'
            ? Number(entry)
            : NaN;
      if (!Number.isFinite(n)) {
        throw new Error('narrator_phase_index_not_number');
      }
      lessonIndices.push(Math.trunc(n));
    }
    if (!lessonIndices.length) continue;
    phases.push({ key, title: phaseTitle, lessonIndices });
  }

  const draft: NarratorDraft = { title, description, why, phases };
  assertNarratorPhasesValid(draft, lessonCount);
  return draft;
}

/**
 * Every index exactly once + contiguous ascending slices + 3-6 phases.
 * Throws with a machine-readable message on violation.
 */
export function assertNarratorPhasesValid(
  draft: NarratorDraft,
  lessonCount: number,
): void {
  const maxPhases = 6;
  const minPhases = Math.min(3, Math.max(1, lessonCount));
  if (draft.phases.length < minPhases || draft.phases.length > maxPhases) {
    throw new Error(`narrator_phase_count_${draft.phases.length}`);
  }

  let cursor = 0;
  for (const phase of draft.phases) {
    for (const idx of phase.lessonIndices) {
      if (idx !== cursor) {
        throw new Error(`narrator_slice_broken_at_${idx}_expected_${cursor}`);
      }
      cursor += 1;
    }
  }
  if (cursor !== lessonCount) {
    throw new Error(`narrator_coverage_${cursor}_of_${lessonCount}`);
  }
}
