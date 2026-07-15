/** Compact intake → unit body rewrite prompts (flattened units). */

export const LESSON_BODY_PERSONALIZER_PROMPT_VERSION =
  'lesson_body_personalizer_v2';

export type LessonBodyUserPacket = {
  roles: string[];
  skills: string[];
  styles: string[];
  job: string | null;
  motive: string[];
  chat: string;
  /** Learner profile snapshot fields (present when a profile is pinned). */
  track?: string;
  stage?: number;
  target?: number;
  mins?: number;
};

/** Stable profile fields safe to feed the rewrite prompt. */
export type LessonBodyProfileHints = {
  primaryTrackSlug: string;
  provisionalStage: number;
  targetStage: number;
  learningStyleWeights: Record<string, number>;
  weeklyEffectiveMinutes: number;
};

/**
 * Safe fields the LLM may rewrite, keyed by lesson type:
 * - reading: objective + sections wording
 * - practice/mini_project/interactive: objective + task + hints
 * - quiz: objective only
 * - video: objective + note
 * Questions/answers, acceptanceCriteria, keyTakeaways, starterHtml and URLs
 * are NEVER sent for rewrite and NEVER merged back from the model.
 */
export type LessonBodySafeFields = {
  objective: string;
  sections?: string[];
  task?: string;
  hints?: string[];
  note?: string;
};

export type LessonBodyRewriteDraft = {
  objective?: string;
  sections?: string[];
  task?: string;
  hints?: string[];
  note?: string;
};

export function buildLessonBodyPersonalizerSystemPrompt(): string {
  return [
    'Arc lesson content personalizer.',
    'Rewrite teaching copy for THIS learner using intake answers.',
    'Return JSON only with exactly the fields you were given:',
    '{"objective":string,"sections"?:[string],"task"?:string,"hints"?:[string],"note"?:string}',
    'Hard rules:',
    '- Only rewrite fields present in the input. Never add other fields.',
    '- sections: keep the SAME count and order; rewrite wording only.',
    '- hints: keep the same count; rewrite wording only.',
    '- Do NOT invent URLs, questions, answers, or acceptance criteria.',
    '- Personalize examples/tone for u.job, u.skills, u.styles, u.motive, u.chat.',
    '- Stay factually aligned with the original teaching points.',
    '- Compact. No markdown fences.',
  ].join(' ');
}

export function buildLessonBodyPersonalizerUserPrompt(input: {
  user: LessonBodyUserPacket;
  lessonTitle: string;
  lessonType: string;
  fields: LessonBodySafeFields;
}): string {
  return JSON.stringify({
    task: 'personalize_lesson_body',
    u: input.user,
    lesson: {
      title: input.lessonTitle,
      type: input.lessonType,
      fields: input.fields,
    },
    forbid:
      'Do not emit questions, answers, acceptanceCriteria, keyTakeaways, starterHtml, or URLs.',
  });
}

export function buildLessonBodyUserPacket(input: {
  targetRoles: string[];
  knownSkills: string[];
  learningStyles: string[];
  currentProfession: string | null;
  motivation: string[];
  rawAnswers: Record<string, unknown>;
  chatTranscript: Array<{ role: string; content: string }>;
  /** Pinned learner profile — preferred over mutable Goal fields when set. */
  profile?: LessonBodyProfileHints | null;
}): LessonBodyUserPacket {
  const skillsFromRaw = asStringList(input.rawAnswers.skills).filter(
    (s) => s !== 'none',
  );
  const skills = [
    ...new Set([
      ...input.knownSkills.filter((s) => s !== 'none'),
      ...skillsFromRaw,
      ...asStringList(input.rawAnswers.skillsOther),
    ]),
  ].slice(0, 20);

  const chat = input.chatTranscript
    .slice(-12)
    .map((m) => `${m.role[0]}:${trimWords(m.content, 28)}`)
    .join('|')
    .slice(0, 900);

  const profile = input.profile;
  const profileStyles = profile
    ? Object.entries(profile.learningStyleWeights ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([style]) => style)
    : [];

  return {
    roles: input.targetRoles.slice(0, 5),
    skills,
    styles: (profileStyles.length ? profileStyles : input.learningStyles).slice(
      0,
      6,
    ),
    job: input.currentProfession,
    motive: input.motivation.slice(0, 5),
    chat,
    ...(profile
      ? {
          track: profile.primaryTrackSlug,
          stage: profile.provisionalStage,
          target: profile.targetStage,
          mins: profile.weeklyEffectiveMinutes,
        }
      : {}),
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
