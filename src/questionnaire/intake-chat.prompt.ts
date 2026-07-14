import type {
  QuestionnaireSchemaDto,
  QuestionnaireStepDto,
} from './schema/schema.types';
import type { QuestionnaireAnswers } from './types/answers';
import { listMissingFields } from './questionnaire.validation';

export const INTAKE_CHAT_PROMPT_VERSION = 'intake_chat_v3';

/** First root field still missing (chips show this next). */
export function nextMissingStep(
  schema: QuestionnaireSchemaDto,
  answers: QuestionnaireAnswers,
): QuestionnaireStepDto | null {
  const missing = listMissingFields(answers, schema);
  for (const key of missing) {
    const root = key.split('.')[0]!.replace(/Other$/, '');
    const step = schema.steps.find((s) => s.id === root);
    if (step) return step;
  }
  return null;
}

/** Soft ack + next schema title — no LLM. */
export function buildDeterministicAssistantMessage(
  schema: QuestionnaireSchemaDto,
  answers: QuestionnaireAnswers,
  opts: { isStart?: boolean } = {},
): string {
  const next = nextMissingStep(schema, answers);
  if (!next) {
    return 'Great — I have everything I need. Tap Generate roadmap when you are ready.';
  }
  if (opts.isStart) {
    return `Hi — quick goal interview. ${next.title}`;
  }
  return `Got it. ${next.title}`;
}

/** Drop empty draft pads so prompt stays tiny. */
export function compactAnswersForPrompt(
  answers: QuestionnaireAnswers,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answers)) {
    if (value == null) continue;
    if (value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      'days' in value &&
      'times' in value
    ) {
      const sched = value as { days: unknown; times: unknown };
      const days = Array.isArray(sched.days) ? sched.days : [];
      const times = Array.isArray(sched.times) ? sched.times : [];
      if (!days.length && !times.length) continue;
      out[key] = { days, times };
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** Compact schema — only the next focus field. */
export function buildIntakeChatSystemPrompt(
  schema: QuestionnaireSchemaDto,
  answers: QuestionnaireAnswers,
): string {
  const next = nextMissingStep(schema, answers);
  const focus = next
    ? next.uiKind === 'schedule'
      ? {
          id: next.id,
          kind: 'schedule',
          days: next.scheduleDays ?? [],
          times: (next.scheduleTimes ?? []).map((t) => t.value),
        }
      : {
          id: next.id,
          selection: next.selection,
          allowOther: Boolean(next.allowOther),
          options: next.options.map((o) => o.value),
        }
    : null;

  return [
    'Arc intake. One short question. Map text→option VALUE tokens only.',
    'Schedule→{days,times}. allowOther→"other"+`${id}Other`.',
    'JSON: {"assistantMessage":string,"partialAnswers":object,"done":boolean}',
    'partialAnswers=NEW tokens only this turn. assistantMessage≤120 chars.',
    'done=true only if field fully answered and no more missing.',
    `focus:${JSON.stringify(focus)}`,
  ].join('\n');
}

export function buildIntakeChatUserPrompt(input: {
  transcript: Array<{ role: 'user' | 'assistant'; content: string }>;
  partialAnswers: QuestionnaireAnswers;
  missingFields: string[];
  userMessage: string | null;
}): string {
  return JSON.stringify({
    a: compactAnswersForPrompt(input.partialAnswers),
    miss: input.missingFields.slice(0, 6),
    // last 2 turns
    recent: input.transcript.slice(-2).map((m) => ({
      r: m.role === 'user' ? 'u' : 'a',
      c: m.content.slice(0, 240),
    })),
    u: input.userMessage?.slice(0, 400) ?? null,
    task: input.userMessage
      ? 'Extract tokens. Ask next missing.'
      : 'Greet 1 sentence. Ask focus field.',
  });
}
