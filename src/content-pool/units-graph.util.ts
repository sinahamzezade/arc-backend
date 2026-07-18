export class UnitsGraphError extends Error {
  constructor(
    readonly code: 'CONTENT_GRAPH_CYCLE' | 'CONTENT_PREREQ_UNRESOLVED',
    message: string,
  ) {
    super(message);
    this.name = 'UnitsGraphError';
  }
}

export type SkillIndexEntry = {
  id: string;
  title: string;
  prerequisites: string[];
  level: number;
};

/** Fail closed: every prerequisite must resolve to a known skill. */
export function assertPrereqsResolved(skills: SkillIndexEntry[]): void {
  const ids = new Set(skills.map((s) => s.id));
  for (const skill of skills) {
    for (const prereq of skill.prerequisites ?? []) {
      if (!ids.has(prereq)) {
        throw new UnitsGraphError(
          'CONTENT_PREREQ_UNRESOLVED',
          `Skill "${skill.id}" prerequisite "${prereq}" not in skills index`,
        );
      }
    }
  }
}

/**
 * Kahn topo sort. Throws CONTENT_GRAPH_CYCLE if cycle or unreachable nodes.
 * Returns skills in prerequisite-safe order; ties broken by level ascending then id.
 */
export function topologicalSortSkills(
  skills: SkillIndexEntry[],
): SkillIndexEntry[] {
  assertPrereqsResolved(skills);
  const byId = new Map(skills.map((s) => [s.id, s]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const s of skills) {
    indegree.set(s.id, 0);
    dependents.set(s.id, []);
  }
  for (const s of skills) {
    for (const p of s.prerequisites ?? []) {
      indegree.set(s.id, (indegree.get(s.id) ?? 0) + 1);
      dependents.get(p)!.push(s.id);
    }
  }

  const ready = skills
    .filter((s) => (indegree.get(s.id) ?? 0) === 0)
    .sort(compareSkill)
    .map((s) => s.id);

  const ordered: SkillIndexEntry[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    ordered.push(byId.get(id)!);
    for (const child of dependents.get(id) ?? []) {
      const next = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, next);
      if (next === 0) {
        ready.push(child);
        ready.sort((a, b) => compareSkill(byId.get(a)!, byId.get(b)!));
      }
    }
  }

  if (ordered.length !== skills.length) {
    const leftover = skills
      .filter((s) => !ordered.some((o) => o.id === s.id))
      .map((s) => s.id);
    throw new UnitsGraphError(
      'CONTENT_GRAPH_CYCLE',
      `Skills index has a cycle involving: ${leftover.join(', ')}`,
    );
  }
  return ordered;
}

function compareSkill(a: SkillIndexEntry, b: SkillIndexEntry): number {
  if (a.level !== b.level) return a.level - b.level;
  return a.id.localeCompare(b.id);
}

/** Prerequisite closure of a skill set over the index. */
export function prerequisiteClosure(
  skillIds: string[],
  skillsById: Map<string, SkillIndexEntry>,
): Set<string> {
  const out = new Set<string>();
  const stack = [...skillIds];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    const skill = skillsById.get(id);
    if (!skill) continue;
    for (const p of skill.prerequisites ?? []) {
      if (!out.has(p)) stack.push(p);
    }
  }
  return out;
}

/** 'frontend' → 'Frontend', 'data-science' → 'Data Science'. */
export function domainTitle(domain: string): string {
  return domain
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
