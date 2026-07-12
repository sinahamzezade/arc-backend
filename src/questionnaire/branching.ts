import type {
  QuestionnaireAnswersLike,
  QuestionnaireSchemaDto,
  QuestionnaireStepDto,
  StepVisibleWhen,
} from './schema/schema.types';

function asRules(
  visibleWhen: StepVisibleWhen | StepVisibleWhen[] | undefined | null,
): StepVisibleWhen[] {
  if (!visibleWhen) return [];
  return Array.isArray(visibleWhen) ? visibleWhen : [visibleWhen];
}

function fieldValues(
  answers: QuestionnaireAnswersLike,
  field: string,
): string[] {
  const value = answers[field];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string' && value) {
    return [value];
  }
  if (
    value &&
    typeof value === 'object' &&
    'days' in value &&
    'times' in value
  ) {
    const schedule = value as { days?: unknown; times?: unknown };
    const days = Array.isArray(schedule.days)
      ? schedule.days.filter((d): d is string => typeof d === 'string')
      : [];
    const times = Array.isArray(schedule.times)
      ? schedule.times.filter((t): t is string => typeof t === 'string')
      : [];
    return [...days, ...times];
  }
  return [];
}

function matchesRule(
  answers: QuestionnaireAnswersLike,
  rule: StepVisibleWhen,
): boolean {
  const actual = fieldValues(answers, rule.field);
  const expected = Array.isArray(rule.value) ? rule.value : [rule.value];

  switch (rule.op) {
    case 'eq':
      return (
        actual.length === expected.length &&
        expected.every((token) => actual.includes(token))
      );
    case 'neq':
      return !(
        actual.length === expected.length &&
        expected.every((token) => actual.includes(token))
      );
    case 'includes':
      return expected.some((token) => actual.includes(token));
    case 'excludes':
      return expected.every((token) => !actual.includes(token));
    default:
      return true;
  }
}

/** Question Engine: evaluate adaptive branch rules against current answers. */
export function isStepVisible(
  step: Pick<QuestionnaireStepDto, 'visibleWhen'>,
  answers: QuestionnaireAnswersLike,
): boolean {
  const rules = asRules(step.visibleWhen);
  if (!rules.length) return true;
  return rules.every((rule) => matchesRule(answers, rule));
}

export function getVisibleSteps(
  schema: QuestionnaireSchemaDto,
  answers: QuestionnaireAnswersLike,
): QuestionnaireStepDto[] {
  return schema.steps
    .slice()
    .sort((a, b) => a.stepNumber - b.stepNumber)
    .filter((step) => isStepVisible(step, answers));
}

export function isFieldVisible(
  schema: QuestionnaireSchemaDto,
  fieldKey: string,
  answers: QuestionnaireAnswersLike,
): boolean {
  const step = schema.steps.find((s) => s.id === fieldKey);
  if (!step) return false;
  return isStepVisible(step, answers);
}
