import type { QuestionnaireAnswers } from './types/answers';
import type { IntakeSuggestions } from './intake-chat.suggestions';

export const INTAKE_CHAT_PROMPT_VERSION = 'intake_chat_v4';

/** Rotate so the same ack never repeats twice in a row. */
const DETERMINISTIC_ACKS = [
  'Nice.',
  'Okay.',
  'Noted.',
  'Sounds good.',
  'Alright.',
] as const;

/** Soft ack + next question title — no LLM. */
export function buildDeterministicAssistantMessage(
  nextQuestionTitle: string | null,
  opts: { isStart?: boolean; assistantTurnIndex?: number } = {},
): string {
  if (!nextQuestionTitle) {
    return 'Great — I have everything I need. Review your answers, then generate your roadmap.';
  }
  if (opts.isStart) {
    return `Hi — quick goal interview. ${nextQuestionTitle}`;
  }
  const idx = Math.max(0, opts.assistantTurnIndex ?? 0);
  const ack = DETERMINISTIC_ACKS[idx % DETERMINISTIC_ACKS.length]!;
  return `${ack} ${nextQuestionTitle}`;
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
    if (typeof value === 'object' && !Array.isArray(value)) {
      const row = value as Record<string, unknown>;
      if ('days' in row && 'times' in row) {
        const days = Array.isArray(row.days) ? row.days : [];
        const times = Array.isArray(row.times) ? row.times : [];
        if (!days.length && !times.length) continue;
        out[key] = { days, times };
        continue;
      }
      if ('primary' in row && 'secondary' in row && !row.primary) continue;
    }
    out[key] = value;
  }
  return out;
}

/** Answer shape hint for compound v4 uiKinds — keeps LLM output mappable. */
function shapeHintForFocus(focus: IntakeSuggestions | null): string | null {
  if (!focus) return null;
  switch (focus.fieldId) {
    case 'goal':
      return 'goal={"primary":token,"secondary":[tokens]} (primary required)';
    case 'skills':
      return focus.subField === 'exposure'
        ? `skills item {"skillSlug":"${focus.skillSlug ?? ''}","exposureLevel":level-token}`
        : 'skills=[{"skillSlug":token,"exposureLevel":"heard_of"}] or [] if none';
    case 'studyHours':
      return 'studyHours=token; preferredSessionMinutes=token (both flat keys)';
    case 'targetOutcome':
      return 'targetOutcome=token; deadline=token (both flat keys)';
    case 'currentContext':
      return 'currentContext=token; useFrequency=token (both flat keys)';
    case 'barriers':
      return 'confidence=token (flat); barriers=[tokens]';
    case 'schedule':
      return 'schedule={days:[],times:[tokens]} (times required; days unused)';
    default:
      return null;
  }
}

/** Compact schema — only the next focus (sub)question. */
export function buildIntakeChatSystemPrompt(
  focus: IntakeSuggestions | null,
): string {
  const focusJson = focus
    ? focus.selection === 'schedule'
      ? {
          id: focus.fieldId,
          kind: 'schedule',
          times: (focus.times ?? []).map((t) => t.value),
        }
      : {
          id: focus.fieldId,
          ...(focus.subField ? { sub: focus.subField } : {}),
          ...(focus.skillSlug ? { skill: focus.skillSlug } : {}),
          selection: focus.selection,
          allowOther: focus.allowOther,
          options: focus.options.map((o) => o.value),
        }
    : null;
  const shape = shapeHintForFocus(focus);

  return [
    'Arc intake. One short question. Map text→option VALUE tokens only.',
    'Schedule→{days:[],times:[tokens]} (times required). allowOther→"other"+`${id}Other`.',
    ...(shape ? [`Shape: ${shape}`] : []),
    'JSON: {"assistantMessage":string,"partialAnswers":object,"done":boolean}',
    'partialAnswers=NEW tokens only this turn. assistantMessage≤120 chars.',
    'done=true only if field fully answered and no more missing.',
    `focus:${JSON.stringify(focusJson)}`,
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
