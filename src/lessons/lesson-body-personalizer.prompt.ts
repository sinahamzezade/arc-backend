/** Compact intake → lesson body rewrite prompts. */

export const LESSON_BODY_PERSONALIZER_PROMPT_VERSION =
  'lesson_body_personalizer_v1';

export type LessonBodyUserPacket = {
  roles: string[];
  skills: string[];
  styles: string[];
  job: string | null;
  motive: string[];
  chat: string;
};

export type LessonBodyPageDraft = {
  id: string;
  title: string;
  blocks: Array<
    | { type: 'text'; body: string }
    | { type: 'callout'; title: string; body: string }
    | { type: 'code'; label: string; code: string }
  >;
};

export type LessonBodyRewriteDraft = {
  objective?: string;
  arloPrompt?: string;
  suggestedArlo?: string[];
  pages: LessonBodyPageDraft[];
};

export function buildLessonBodyPersonalizerSystemPrompt(): string {
  return [
    'Arc lesson content personalizer.',
    'Rewrite teaching copy for THIS learner using intake answers.',
    'Return JSON only:',
    '{"objective":string,"arloPrompt":string,"suggestedArlo":[string],"pages":[{"id":string,"title":string,"blocks":[...]}]}',
    'Hard rules:',
    '- Keep every page id exactly as given. Do not add/remove pages.',
    '- Blocks: type text|callout|code only. Same block count ±1 per page OK.',
    '- Do NOT change practice, quiz, remediation, rewards, or invent URLs.',
    '- Personalize examples/tone for u.job, u.skills, u.styles, u.motive, u.chat.',
    '- Stay factually aligned with scaffold teaching points.',
    '- Compact. No markdown fences.',
  ].join(' ');
}

export function buildLessonBodyPersonalizerUserPrompt(input: {
  user: LessonBodyUserPacket;
  lessonTitle: string;
  objective: string;
  pages: LessonBodyPageDraft[];
}): string {
  return JSON.stringify({
    task: 'personalize_lesson_body',
    u: input.user,
    lesson: {
      title: input.lessonTitle,
      objective: input.objective,
      pages: input.pages,
    },
    forbid: 'Do not invent page ids. Do not emit practice or quiz.',
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

  return {
    roles: input.targetRoles.slice(0, 5),
    skills,
    styles: input.learningStyles.slice(0, 6),
    job: input.currentProfession,
    motive: input.motivation.slice(0, 5),
    chat,
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
