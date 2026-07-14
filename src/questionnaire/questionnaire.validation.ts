import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { isFieldVisible } from './branching';
import { OTHER_TEXT_MAX } from './constants/schema-version';
import type {
  QuestionnaireSchemaDto,
  QuestionnaireStepDto,
} from './schema/schema.types';
import {
  asSchedule,
  asString,
  asStringArray,
  emptyQuestionnaireAnswers,
  isScheduleAnswer,
  type QuestionnaireAnswers,
  type ScheduleAnswer,
} from './types/answers';

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function trimOther(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > OTHER_TEXT_MAX) {
    throw new AppException(
      AuthErrorCode.VALIDATION_ERROR,
      `Other text must be at most ${OTHER_TEXT_MAX} characters`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return trimmed;
}

function assertAllowed(
  field: string,
  values: string[],
  allowed: readonly string[],
) {
  const unknown = values.filter((v) => !allowed.includes(v));
  if (unknown.length) {
    throw new AppException(
      AuthErrorCode.VALIDATION_ERROR,
      `Invalid ${field} value(s): ${unknown.join(', ')}`,
      HttpStatus.BAD_REQUEST,
    );
  }
}

function filterKnown(values: string[], allowed: readonly string[]) {
  return values.filter((v) => allowed.includes(v));
}

function isFreeSkillToken(value: string): boolean {
  if (!value || value.length > 64) return false;
  if (value === 'none' || value === 'other') return true;
  return /^[a-z0-9][a-z0-9-]{0,62}$/i.test(value);
}

function sanitizeFreeSkillValues(values: string[]): string[] {
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

function optionValuesForStep(step: QuestionnaireStepDto): string[] {
  if (step.uiKind === 'schedule') {
    return [
      ...(step.scheduleDays ?? []),
      ...(step.scheduleTimes ?? []).map((t) => t.value),
    ];
  }
  const values = step.options.map((o) => o.value);
  if (step.allowOther && step.selection === 'single') {
    return [...values, 'other'];
  }
  return values;
}

function normalizeSchedule(
  raw: unknown,
  step: QuestionnaireStepDto,
): ScheduleAnswer {
  const daysAllowed = step.scheduleDays ?? [];
  const timesAllowed = (step.scheduleTimes ?? []).map((t) => t.value);
  if (!raw || typeof raw !== 'object') {
    return { days: [], times: [] };
  }
  const schedule = raw as Record<string, unknown>;
  return {
    days: isStringArray(schedule.days)
      ? filterKnown(schedule.days, daysAllowed)
      : [],
    times: isStringArray(schedule.times)
      ? filterKnown(schedule.times, timesAllowed)
      : [],
  };
}

/** Soft-normalize draft answers; allow incomplete data. */
export function normalizeDraftAnswers(
  input: unknown,
  schema: QuestionnaireSchemaDto,
): QuestionnaireAnswers {
  const base = emptyQuestionnaireAnswers();
  if (!input || typeof input !== 'object') {
    return base;
  }

  const raw = input as Record<string, unknown>;

  for (const step of schema.steps) {
    const key = step.id;
    const otherKey = `${key}Other`;

    if (step.uiKind === 'schedule') {
      base[key] = normalizeSchedule(raw[key], step);
      continue;
    }

    const allowed = optionValuesForStep(step);
    if (step.selection === 'multi') {
      if (key === 'skills' && isStringArray(raw[key])) {
        base[key] = sanitizeFreeSkillValues(raw[key]);
      } else if (isStringArray(raw[key])) {
        base[key] = filterKnown(raw[key], allowed);
      } else if (typeof raw[key] === 'string' && allowed.includes(raw[key])) {
        // Clients sometimes store single-select shape; keep the pick.
        base[key] = [raw[key]];
      } else {
        base[key] = [];
      }
    } else if (typeof raw[key] === 'string' && allowed.includes(raw[key])) {
      base[key] = raw[key];
    } else if (isStringArray(raw[key]) && raw[key].length === 1) {
      // Multi UI write into a single-select step — take first known value.
      const only = raw[key][0]!;
      base[key] = allowed.includes(only) ? only : '';
    } else {
      base[key] = '';
    }

    if (step.allowOther) {
      const other = trimOther(raw[otherKey]);
      if (other) base[otherKey] = other;
    }
  }

  return base;
}

export function assertCompleteAnswers(
  input: unknown,
  schema: QuestionnaireSchemaDto,
): QuestionnaireAnswers {
  const answers = normalizeDraftAnswers(input, schema);
  const missing = listMissingFields(answers, schema);
  if (missing.length) {
    throw new AppException(
      AuthErrorCode.VALIDATION_ERROR,
      `Missing required fields: ${missing.join(', ')}`,
      HttpStatus.BAD_REQUEST,
    );
  }

  for (const step of schema.steps) {
    const key = step.id;
    if (!isFieldVisible(schema, key, answers)) continue;

    if (step.uiKind === 'schedule') {
      const schedule = asSchedule(answers, key);
      const daysAllowed = step.scheduleDays ?? [];
      const timesAllowed = (step.scheduleTimes ?? []).map((t) => t.value);
      assertAllowed(`${key}.days`, schedule.days, daysAllowed);
      assertAllowed(`${key}.times`, schedule.times, timesAllowed);
      continue;
    }

    const allowed = optionValuesForStep(step);
    const other = asString(answers, `${key}Other`).trim();

    if (step.selection === 'multi') {
      const values = asStringArray(answers, key);
      if (key === 'skills') {
        if (values.length) {
          const bad = values.filter(
            (v) => !sanitizeFreeSkillValues([v]).length,
          );
          if (bad.length) {
            throw new AppException(
              AuthErrorCode.VALIDATION_ERROR,
              `Invalid skills value(s): ${bad.join(', ')}`,
              HttpStatus.BAD_REQUEST,
            );
          }
        }
        if (values.includes('none') && values.length > 1) {
          throw new AppException(
            AuthErrorCode.VALIDATION_ERROR,
            'skills cannot combine "none" with other values',
            HttpStatus.BAD_REQUEST,
          );
        }
        continue;
      }
      if (values.length) {
        assertAllowed(key, values, allowed);
      }
      continue;
    }

    const value = asString(answers, key);
    if (value) {
      assertAllowed(key, [value], allowed);
    }
    if (value === 'other' && !other) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        `${key}Other is required when ${key} is other`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  return answers;
}

/** Visible required fields still empty after draft normalize. */
export function listMissingFields(
  answers: QuestionnaireAnswers,
  schema: QuestionnaireSchemaDto,
): string[] {
  const missing: string[] = [];
  for (const step of schema.steps) {
    const key = step.id;
    if (!isFieldVisible(schema, key, answers)) continue;

    if (step.uiKind === 'schedule') {
      const schedule = asSchedule(answers, key);
      if (!schedule.days.length) missing.push(`${key}.days`);
      if (!schedule.times.length) missing.push(`${key}.times`);
      continue;
    }

    const other = asString(answers, `${key}Other`).trim();
    if (step.selection === 'multi') {
      const values = asStringArray(answers, key);
      if (!values.length && !(step.allowOther && other)) {
        missing.push(key);
      }
      continue;
    }

    const value = asString(answers, key);
    if (!value && !(step.allowOther && other)) {
      missing.push(key);
    } else if (value === 'other' && !other) {
      missing.push(`${key}Other`);
    }
  }
  return missing;
}

export function withOther(
  values: string[],
  other?: string,
): { values: string[]; other?: string } {
  return other ? { values, other } : { values };
}

export function isScheduleShape(value: unknown): boolean {
  return isScheduleAnswer(value);
}
