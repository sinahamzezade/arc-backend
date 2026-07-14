/** Compact LLM roadmap planner — Nest hydrates RoadmapPlanDto from lesson picks. */

export const ROADMAP_LLM_PLANNER_PROMPT_VERSION = 'roadmap_llm_planner_v3';

export type CompactLesson = {
  /** Short index into allow-list (token-cheap). */
  n: number;
  t: string;
  m: number;
  sk: string;
  st: string[];
  d: string;
};

export type CompactCourse = {
  n: number;
  t: string;
  /** Lesson indices belonging to this course. */
  lessons: number[];
};

export type CompactUserPacket = {
  roles: string[];
  skills: string[];
  hours: number;
  weeks: number;
  styles: string[];
  conf: string | null;
  job: string | null;
  motive: string[];
  chat: string;
  seed: number;
};

export type LlmPlannerPhaseDraft = {
  key: string;
  title: string;
  /** Snapshot lesson template ids in LLM-chosen order. */
  lesson_ids: string[];
};

export type LlmPlannerDraft = {
  title: string;
  description: string;
  why: string;
  phases: LlmPlannerPhaseDraft[];
};

export function buildRoadmapLlmPlannerSystemPrompt(): string {
  return [
    'Arc personal roadmap planner.',
    'YOU decide which lessons to INCLUDE and the EXACT ORDER for this learner.',
    'Different answers MUST produce different lesson sets and order.',
    'Return JSON only:',
    '{"title":string,"desc":string,"why":string,"phases":[{"k":string,"t":string,"lessons":[n,...]}]}',
    'Hard rules:',
    '- phases[].lessons = lesson indices (n) from cat.lessons ONLY.',
    '- Do NOT return catalog order (0,1,2,3…). Re-order for THIS user.',
    '- Do NOT include every lesson. Select a SUBSET that fits answers + budget.',
    '- SKIP lessons that match known skills (u.skills) — omit those indices.',
    '- Prefer lessons matching learning styles (u.styles vs lesson.st).',
    '- Budget: sum(lesson.m) ≈ u.hours * u.weeks * 60 * 0.85. Target 10-28 lessons.',
    '- 3-6 phases. Phase titles personal. why = one sentence why this order.',
    '- Use u.seed to vary choices. Beginner→advanced when possible.',
    '- Compact keys only. No markdown.',
  ].join(' ');
}

export function buildRoadmapLlmPlannerUserPrompt(input: {
  user: CompactUserPacket;
  courses: CompactCourse[];
  lessons: CompactLesson[];
  recipeTitle: string;
  roleSlug: string;
}): string {
  return JSON.stringify({
    task: 'select_and_reorder_lessons',
    u: input.user,
    role: input.roleSlug,
    recipe: input.recipeTitle,
    cat: {
      courses: input.courses,
      lessons: input.lessons,
    },
    forbid:
      'Do not emit sequential catalog order. Skip known skills. Subset only.',
  });
}

/** Flatten questionnaire + chat into compact packet. */
export function buildCompactUserPacket(input: {
  profile: {
    target_roles: string[];
    known_skills: string[];
    learning_styles: string[];
    confidence: string | null;
    current_profession: string | null;
    motivation: string[];
  };
  rawAnswers: Record<string, unknown>;
  chatTranscript: Array<{ role: string; content: string }>;
  hours: number;
  weeks: number;
  seed: number;
}): CompactUserPacket {
  const skillsFromRaw = asStringList(input.rawAnswers.skills).filter(
    (s) => s !== 'none',
  );
  const skills = [
    ...new Set([
      ...input.profile.known_skills.filter((s) => s !== 'none'),
      ...skillsFromRaw,
      ...asStringList(input.rawAnswers.skillsOther),
    ]),
  ].slice(0, 20);

  const chat = input.chatTranscript
    .slice(-12)
    .map((m) => `${m.role[0]}:${trimWords(m.content, 28)}`)
    .join('|')
    .slice(0, 900);

  return {
    roles: input.profile.target_roles.slice(0, 5),
    skills,
    hours: input.hours,
    weeks: input.weeks,
    styles: input.profile.learning_styles.slice(0, 6),
    conf: input.profile.confidence,
    job: input.profile.current_profession,
    motive: input.profile.motivation.slice(0, 5),
    chat,
    seed: input.seed % 100000,
  };
}

function asStringList(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean);
}

function trimWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return words.join(' ');
  return `${words.slice(0, maxWords).join(' ')}…`;
}
