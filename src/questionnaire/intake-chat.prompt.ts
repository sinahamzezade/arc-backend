import type { QuestionnaireSchemaDto } from './schema/schema.types';
import type { QuestionnaireAnswers } from './types/answers';
import { listMissingFields } from './questionnaire.validation';

export const INTAKE_CHAT_PROMPT_VERSION = 'intake_chat_v2';

/** Compact schema — only missing fields, short option lists. Cuts tokens → faster. */
export function buildIntakeChatSystemPrompt(
  schema: QuestionnaireSchemaDto,
  answers: QuestionnaireAnswers,
): string {
  const missing = new Set(listMissingFields(answers, schema));
  const focusSteps = schema.steps.filter(
    (step) =>
      missing.has(step.id) ||
      missing.has(`${step.id}.days`) ||
      missing.has(`${step.id}.times`) ||
      missing.has(`${step.id}Other`),
  );
  const steps = (focusSteps.length ? focusSteps : schema.steps.slice(0, 2)).map(
    (step) => {
      if (step.uiKind === 'schedule') {
        return {
          id: step.id,
          title: step.title,
          kind: 'schedule',
          days: step.scheduleDays ?? [],
          times: (step.scheduleTimes ?? []).map((t) => t.value),
        };
      }
      return {
        id: step.id,
        title: step.title,
        selection: step.selection,
        allowOther: Boolean(step.allowOther),
        // value only — labels burn tokens
        options: step.options.map((o) => o.value),
      };
    },
  );

  return [
    'Arc goal interview coach. Ask ONE short question per turn.',
    'Map free text → schema option VALUE tokens only. Never invent values.',
    'Schedule → {days,times} with allowed tokens only.',
    'allowOther: use value "other" + `${id}Other` free text.',
    'JSON only: {"assistantMessage":string,"partialAnswers":object,"done":boolean}',
    'partialAnswers = merge of current + new tokens this turn.',
    'done=true only when no missing fields remain.',
    `Missing focus fields:\n${JSON.stringify(steps)}`,
  ].join('\n');
}

export function buildIntakeChatUserPrompt(input: {
  transcript: Array<{ role: 'user' | 'assistant'; content: string }>;
  partialAnswers: QuestionnaireAnswers;
  missingFields: string[];
  userMessage: string | null;
}): string {
  return JSON.stringify({
    answers: input.partialAnswers,
    missing: input.missingFields,
    // last 4 turns only
    recent: input.transcript.slice(-4),
    user: input.userMessage,
    task:
      input.userMessage === null
        ? 'Greet in 1 sentence. Ask career goal.'
        : 'Extract tokens from user. Ask next missing field.',
  });
}
