import { isFieldVisible } from './branching';
import type {
  QuestionnaireSchemaDto,
  QuestionnaireStepDto,
} from './schema/schema.types';
import { listMissingFields } from './questionnaire.validation';
import type { QuestionnaireAnswers } from './types/answers';

export type IntakeSuggestionOption = {
  value: string;
  label: string;
};

export type IntakeSuggestions = {
  fieldId: string;
  title: string;
  selection: 'single' | 'multi' | 'schedule';
  allowOther: boolean;
  options: IntakeSuggestionOption[];
  /** schedule only */
  days?: string[];
  times?: IntakeSuggestionOption[];
};

/** Next missing field that has pickable options (or schedule). */
export function buildIntakeSuggestions(
  schema: QuestionnaireSchemaDto,
  answers: QuestionnaireAnswers,
): IntakeSuggestions | null {
  const missing = listMissingFields(answers, schema);
  if (!missing.length) return null;

  // Prefer first missing root field (goal before goalOther, schedule.days → schedule)
  const rootIds: string[] = [];
  for (const key of missing) {
    const root = key.split('.')[0]!.replace(/Other$/, '');
    if (!rootIds.includes(root)) rootIds.push(root);
  }

  for (const fieldId of rootIds) {
    const step = schema.steps.find((s) => s.id === fieldId);
    if (!step) continue;
    if (!isFieldVisible(schema, fieldId, answers)) continue;

    if (step.uiKind === 'schedule') {
      return {
        fieldId: step.id,
        title: step.title,
        selection: 'schedule',
        allowOther: false,
        options: [],
        days: step.scheduleDays ?? [],
        times: (step.scheduleTimes ?? []).map((t) => ({
          value: t.value,
          label: t.label,
        })),
      };
    }

    if (step.uiKind === 'options' && step.options.length) {
      const options = step.options.map((o) => ({
        value: o.value,
        label: o.label,
      }));
      if (step.allowOther && !options.some((o) => o.value === 'other')) {
        options.push({ value: 'other', label: 'Other' });
      }
      return {
        fieldId: step.id,
        title: step.title,
        selection: step.selection,
        allowOther: Boolean(step.allowOther),
        options,
      };
    }
  }

  return null;
}

export function allowedValuesForStep(step: QuestionnaireStepDto): string[] {
  if (step.uiKind === 'schedule') {
    return [
      ...(step.scheduleDays ?? []),
      ...(step.scheduleTimes ?? []).map((t) => t.value),
    ];
  }
  const values = step.options.map((o) => o.value);
  if (step.allowOther) return [...values, 'other'];
  return values;
}

export function slugifySkillLabel(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'skill';
}

/** Free-form AI skill tokens (kebab-case / short labels). */
export function isFreeSkillToken(value: string): boolean {
  if (!value || value.length > 64) return false;
  if (value === 'none' || value === 'other') return true;
  return /^[a-z0-9][a-z0-9-]{0,62}$/i.test(value);
}

export function sanitizeFreeSkillValues(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const v = raw.trim();
    if (!isFreeSkillToken(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= 12) break;
  }
  if (out.includes('none') && out.length > 1) return ['none'];
  return out;
}
