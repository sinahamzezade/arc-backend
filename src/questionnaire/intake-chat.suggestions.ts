import { getVisibleSteps } from './branching';
import type {
  QuestionnaireOptionDto,
  QuestionnaireSchemaDto,
  QuestionnaireStepDto,
} from './schema/schema.types';
import {
  asSchedule,
  asSkillEvidence,
  asString,
  asStringArray,
  asTrackSelection,
  type QuestionnaireAnswers,
} from './types/answers';

export type IntakeSuggestionOption = {
  value: string;
  label: string;
};

/**
 * Chat-only progress markers that cannot be derived from normalized answers:
 * - skill-evidence: empty skill list is a valid answer, so we must remember
 *   whether the question was actually asked and answered;
 * - exposure per skill: normalize coerces missing exposure to the default
 *   level, so explicit choices are tracked here;
 * - preferredSessionMinutes: normalize auto-fills a default value.
 */
export type IntakeChatMeta = {
  /** User explicitly answered the skills question (possibly "none"). */
  skillsAnswered?: boolean;
  /** Skill slugs whose exposure level was explicitly chosen. */
  exposureDone?: string[];
  /** preferredSessionMinutes explicitly chosen by the user. */
  sessionAnswered?: boolean;
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
  /**
   * Compound steps: the flat answer key this chip set fills
   * (useFrequency, preferredSessionMinutes, deadline, confidence, barriers)
   * or 'exposure' for the per-skill exposure phase.
   */
  subField?: string;
  /** skill-evidence exposure phase: which skill is being rated. */
  skillSlug?: string;
};

function toOptions(
  options?: QuestionnaireOptionDto[] | null,
): IntakeSuggestionOption[] {
  return (options ?? []).map((o) => ({ value: o.value, label: o.label }));
}

function withOtherOption(
  options: IntakeSuggestionOption[],
  allowOther?: boolean,
): IntakeSuggestionOption[] {
  if (allowOther && !options.some((o) => o.value === 'other')) {
    return [...options, { value: 'other', label: 'Other' }];
  }
  return options;
}

export function humanizeSkillSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Next pending sub-question for a v4 step, in schema step order. */
function suggestionForStep(
  step: QuestionnaireStepDto,
  answers: QuestionnaireAnswers,
  meta: IntakeChatMeta,
): IntakeSuggestions | null {
  const key = step.id;
  const other = asString(answers, `${key}Other`).trim();

  switch (step.uiKind) {
    case 'schedule': {
      const schedule = asSchedule(answers, key);
      if (schedule.times.length) return null;
      return {
        fieldId: key,
        title: step.title,
        selection: 'schedule',
        allowOther: false,
        options: [],
        times: toOptions(step.scheduleTimes),
      };
    }

    case 'track-select': {
      const track = asTrackSelection(answers, key);
      if (track.primary) return null;
      // Chat asks for one primary track; secondary interests are form-only.
      return {
        fieldId: key,
        title: step.title,
        selection: 'single',
        allowOther: false,
        options: toOptions(step.options).filter((o) => o.value !== 'other'),
      };
    }

    case 'skill-evidence': {
      if (!meta.skillsAnswered) {
        return {
          fieldId: key,
          title: step.title,
          selection: 'multi',
          allowOther: Boolean(step.allowOther),
          options: withOtherOption(toOptions(step.options), step.allowOther),
        };
      }
      const done = new Set(meta.exposureDone ?? []);
      const labelByValue = new Map(
        step.options.map((o) => [o.value, o.label] as const),
      );
      for (const entry of asSkillEvidence(answers, key)) {
        if (done.has(entry.skillSlug)) continue;
        const label =
          labelByValue.get(entry.skillSlug) ??
          humanizeSkillSlug(entry.skillSlug);
        return {
          fieldId: key,
          subField: 'exposure',
          skillSlug: entry.skillSlug,
          title: `How independently can you use ${label}?`,
          selection: 'single',
          allowOther: false,
          options: toOptions(step.exposureOptions),
        };
      }
      return null;
    }

    case 'capacity': {
      if (!asString(answers, key)) {
        return {
          fieldId: key,
          title: step.title,
          selection: 'single',
          allowOther: false,
          options: toOptions(step.options),
        };
      }
      if (!meta.sessionAnswered) {
        return {
          fieldId: key,
          subField: 'preferredSessionMinutes',
          title: 'How long should each study session be?',
          selection: 'single',
          allowOther: false,
          options: toOptions(step.sessionOptions),
        };
      }
      return null;
    }

    case 'outcome': {
      if (!asString(answers, key)) {
        return {
          fieldId: key,
          title: step.title,
          selection: 'single',
          allowOther: false,
          options: toOptions(step.options),
        };
      }
      if (!asString(answers, 'deadline')) {
        return {
          fieldId: key,
          subField: 'deadline',
          title: 'When do you want to reach that result?',
          selection: 'single',
          allowOther: false,
          options: toOptions(step.secondaryOptions),
        };
      }
      return null;
    }

    case 'context': {
      if (!asString(answers, key) && !other) {
        return {
          fieldId: key,
          title: step.title,
          selection: 'single',
          allowOther: Boolean(step.allowOther),
          options: withOtherOption(toOptions(step.options), step.allowOther),
        };
      }
      if (!asString(answers, 'useFrequency')) {
        return {
          fieldId: key,
          subField: 'useFrequency',
          title: 'How often do you use this subject today?',
          selection: 'single',
          allowOther: false,
          options: toOptions(step.secondaryOptions),
        };
      }
      return null;
    }

    case 'confidence-barriers': {
      if (!asString(answers, 'confidence')) {
        return {
          fieldId: key,
          subField: 'confidence',
          title: 'How confident are you right now?',
          selection: 'single',
          allowOther: false,
          options: toOptions(step.options),
        };
      }
      // Validation requires at least one listed barrier (Other is additive).
      if (!asStringArray(answers, key).length) {
        return {
          fieldId: key,
          subField: key,
          title: 'What usually gets in the way of learning?',
          selection: 'multi',
          allowOther: Boolean(step.allowOther),
          options: withOtherOption(
            toOptions(step.secondaryOptions),
            step.allowOther,
          ),
        };
      }
      return null;
    }

    default: {
      // plain 'options'
      if (!step.options.length) return null;
      if (step.selection === 'multi') {
        if (asStringArray(answers, key).length || (step.allowOther && other)) {
          return null;
        }
      } else {
        const value = asString(answers, key);
        const pending =
          (!value && !(step.allowOther && other)) ||
          (value === 'other' && !other);
        if (!pending) return null;
      }
      return {
        fieldId: key,
        title: step.title,
        selection: step.selection,
        allowOther: Boolean(step.allowOther),
        options: withOtherOption(toOptions(step.options), step.allowOther),
      };
    }
  }
}

/** Next pending question (or sub-question) across visible steps, in order. */
export function buildIntakeSuggestions(
  schema: QuestionnaireSchemaDto,
  answers: QuestionnaireAnswers,
  meta: IntakeChatMeta = {},
): IntakeSuggestions | null {
  for (const step of getVisibleSteps(schema, answers)) {
    const suggestion = suggestionForStep(step, answers, meta);
    if (suggestion) return suggestion;
  }
  return null;
}

/**
 * Chat-level pending fields: validation missing fields plus chat-only
 * questions (skills select, per-skill exposure, session length) that
 * normalization cannot report as missing.
 */
export function listChatPendingFields(
  schema: QuestionnaireSchemaDto,
  answers: QuestionnaireAnswers,
  meta: IntakeChatMeta,
  validationMissing: string[],
): string[] {
  const pending = [...validationMissing];
  for (const step of getVisibleSteps(schema, answers)) {
    if (step.uiKind === 'skill-evidence') {
      if (!meta.skillsAnswered) {
        pending.push(step.id);
        continue;
      }
      const done = new Set(meta.exposureDone ?? []);
      for (const entry of asSkillEvidence(answers, step.id)) {
        if (!done.has(entry.skillSlug)) {
          pending.push(`${step.id}.exposure.${entry.skillSlug}`);
        }
      }
    }
    if (
      step.uiKind === 'capacity' &&
      !meta.sessionAnswered &&
      !pending.includes('preferredSessionMinutes')
    ) {
      pending.push('preferredSessionMinutes');
    }
  }
  return pending;
}

export function allowedValuesForStep(step: QuestionnaireStepDto): string[] {
  if (step.uiKind === 'schedule') {
    return (step.scheduleTimes ?? []).map((t) => t.value);
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
