import type { QuestionnaireSchemaDto } from './schema/schema.types';

export const QUESTIONNAIRE_AI_PROMPT_VERSION = 'questionnaire_copy_v1';

export function buildQuestionnaireAiSystemPrompt(): string {
  return [
    'You are Arlo questionnaire_copy_v1.',
    'Rewrite questionnaire question copy for a career-learning onboarding flow.',
    'Return ONLY valid JSON matching the schema in the user message.',
    'Hard rules:',
    '- Keep every step id exactly as provided.',
    '- Keep every option value and scheduleTime value exactly as provided.',
    '- You may rewrite title, subtitle, reviewLabel, and option/scheduleTime labels only.',
    '- Do not add, remove, or reorder steps or options.',
    '- Do not invent new field ids or token values.',
    '- Tone: clear, encouraging, concise. No hype, no job guarantees.',
    '- English only.',
  ].join('\n');
}

export function buildQuestionnaireAiUserPrompt(
  schema: QuestionnaireSchemaDto,
): string {
  const skeleton = {
    steps: schema.steps.map((step) => ({
      id: step.id,
      title: step.title,
      subtitle: step.subtitle,
      reviewLabel: step.reviewLabel,
      selection: step.selection,
      uiKind: step.uiKind,
      options: step.options.map((o) => ({
        value: o.value,
        label: o.label,
      })),
      ...(step.scheduleTimes?.length
        ? {
            scheduleTimes: step.scheduleTimes.map((t) => ({
              value: t.value,
              label: t.label,
            })),
          }
        : {}),
    })),
  };

  return [
    'Rewrite copy for each step. Preserve all ids and values.',
    'JSON shape:',
    '{',
    '  "steps": [',
    '    {',
    '      "id": string,',
    '      "title": string,',
    '      "subtitle": string,',
    '      "reviewLabel": string,',
    '      "options": [{ "value": string, "label": string }],',
    '      "scheduleTimes": [{ "value": string, "label": string }] // only if present in input',
    '    }',
    '  ]',
    '}',
    '',
    'Input skeleton:',
    JSON.stringify(skeleton),
  ].join('\n');
}
