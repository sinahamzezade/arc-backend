import type {
  LlmPlannerDraft,
  LlmPlannerPhaseDraft,
} from './roadmap-llm-planner.prompt';

/**
 * Parse compact LLM output. lessons[] values are indices into allowList.
 * Maps indices → lesson template ids.
 */
export function parseLlmPlannerDraft(
  raw: unknown,
  lessonIdByIndex: Map<number, string>,
): LlmPlannerDraft {
  if (!raw || typeof raw !== 'object') {
    throw new Error('planner_draft_not_object');
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
  const why = typeof row.why === 'string' ? row.why.trim().slice(0, 200) : '';

  const phasesRaw = Array.isArray(row.phases) ? row.phases : [];
  const phases: LlmPlannerPhaseDraft[] = [];
  const usedKeys = new Set<string>();
  const usedLessons = new Set<string>();

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

    const rawLessons = Array.isArray(p.lessons)
      ? p.lessons
      : Array.isArray(p.lesson_ids)
        ? p.lesson_ids
        : [];

    const lessonIds: string[] = [];
    for (const entry of rawLessons) {
      let id: string | undefined;
      if (typeof entry === 'number' && Number.isFinite(entry)) {
        id = lessonIdByIndex.get(Math.trunc(entry));
      } else if (typeof entry === 'string') {
        const asNum = Number(entry);
        if (Number.isFinite(asNum) && !entry.includes('-')) {
          id = lessonIdByIndex.get(Math.trunc(asNum));
        } else if (/^[0-9a-f-]{36}$/i.test(entry.trim())) {
          // Allow raw uuid if still in allow-list values
          const hit = [...lessonIdByIndex.entries()].find(
            ([, v]) => v === entry.trim(),
          );
          id = hit?.[1];
        }
      }
      if (!id || usedLessons.has(id)) continue;
      usedLessons.add(id);
      lessonIds.push(id);
      if (lessonIds.length >= 12) break;
    }

    if (!lessonIds.length) continue;
    phases.push({ key, title: phaseTitle, lesson_ids: lessonIds });
    if (phases.length >= 8) break;
  }

  if (!phases.length) {
    throw new Error('planner_draft_no_phases');
  }

  return { title, description, why, phases };
}
