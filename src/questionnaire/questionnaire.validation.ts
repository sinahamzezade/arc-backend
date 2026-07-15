import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { isFieldVisible } from './branching';
import { EXPOSURE_LEVELS } from './constants/profiling';
import { OTHER_TEXT_MAX } from './constants/schema-version';
import type {
  QuestionnaireSchemaDto,
  QuestionnaireStepDto,
} from './schema/schema.types';
import {
  asSchedule,
  asSkillEvidence,
  asString,
  asStringArray,
  asTrackSelection,
  emptyQuestionnaireAnswers,
  isScheduleAnswer,
  isSkillEvidenceAnswer,
  isTrackSelectionAnswer,
  type QuestionnaireAnswers,
  type ScheduleAnswer,
  type SkillEvidenceAnswer,
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
  const timezone =
    typeof schedule.timezone === 'string' && schedule.timezone.trim()
      ? schedule.timezone.trim()
      : undefined;
  return {
    days: isStringArray(schedule.days)
      ? filterKnown(
          schedule.days.map((d) => d.toLowerCase()),
          daysAllowed.map((d) => d.toLowerCase()),
        )
      : [],
    times: isStringArray(schedule.times)
      ? filterKnown(schedule.times, timesAllowed)
      : [],
    ...(timezone ? { timezone } : {}),
  };
}

function normalizeSkillEvidence(
  raw: unknown,
  step: QuestionnaireStepDto,
): SkillEvidenceAnswer[] {
  const exposureAllowed = (step.exposureOptions ?? []).map((o) => o.value);
  const fallbackExposure = exposureAllowed[0] ?? EXPOSURE_LEVELS[0];
  if (!Array.isArray(raw)) return [];
  if (raw.every((item) => typeof item === 'string')) {
    return sanitizeFreeSkillValues(raw as string[])
      .filter((s) => s !== 'none')
      .map((skillSlug) => ({
        skillSlug,
        exposureLevel: fallbackExposure,
      }));
  }
  const out: SkillEvidenceAnswer[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isSkillEvidenceAnswer(item)) continue;
    const skillSlug = item.skillSlug.trim();
    if (!skillSlug || skillSlug === 'none' || seen.has(skillSlug)) continue;
    if (!isFreeSkillToken(skillSlug) && !optionValuesForStep(step).includes(skillSlug)) {
      continue;
    }
    const exposure = exposureAllowed.includes(item.exposureLevel)
      ? item.exposureLevel
      : fallbackExposure;
    seen.add(skillSlug);
    out.push({ skillSlug, exposureLevel: exposure });
    if (out.length >= 12) break;
  }
  return out;
}

function normalizeTrackSelection(
  raw: unknown,
  step: QuestionnaireStepDto,
): { primary: string; secondary: string[] } {
  const allowed = optionValuesForStep(step);
  if (isTrackSelectionAnswer(raw)) {
    const primary = allowed.includes(raw.primary) ? raw.primary : '';
    const secondary = filterKnown(
      raw.secondary.filter((s) => s !== primary),
      allowed,
    );
    return { primary, secondary };
  }
  if (isStringArray(raw) && raw.length) {
    const known = filterKnown(raw, allowed);
    return { primary: known[0] ?? '', secondary: known.slice(1) };
  }
  if (typeof raw === 'string' && allowed.includes(raw)) {
    return { primary: raw, secondary: [] };
  }
  return { primary: '', secondary: [] };
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
      if (typeof raw.timezone === 'string' && raw.timezone.trim()) {
        base.timezone = raw.timezone.trim();
      }
      continue;
    }

    if (step.uiKind === 'skill-evidence') {
      base[key] = normalizeSkillEvidence(raw[key], step);
      if (step.allowOther) {
        const other = trimOther(raw[otherKey]);
        if (other) base[otherKey] = other;
      }
      continue;
    }

    if (step.uiKind === 'track-select') {
      base[key] = normalizeTrackSelection(raw[key], step);
      continue;
    }

    if (step.uiKind === 'capacity') {
      const allowed = optionValuesForStep(step);
      if (typeof raw[key] === 'string' && allowed.includes(raw[key])) {
        base[key] = raw[key];
      } else if (isStringArray(raw[key]) && raw[key].length === 1) {
        const only = raw[key][0]!;
        base[key] = allowed.includes(only) ? only : '';
      } else {
        base[key] = '';
      }
      const sessionOpts = (step.sessionOptions ?? []).map((o) => o.value);
      const sessionRaw =
        raw.preferredSessionMinutes ?? raw.sessionMinutes ?? '';
      const sessionStr = String(sessionRaw);
      if (sessionOpts.includes(sessionStr)) {
        base.preferredSessionMinutes = sessionStr;
      } else if (sessionOpts.length) {
        base.preferredSessionMinutes = sessionOpts[1] ?? sessionOpts[0];
      }
      continue;
    }

    if (step.uiKind === 'outcome') {
      const allowed = optionValuesForStep(step);
      if (typeof raw[key] === 'string' && allowed.includes(raw[key])) {
        base[key] = raw[key];
      } else {
        base[key] = '';
      }
      const deadlines = (step.secondaryOptions ?? []).map((o) => o.value);
      const deadlineRaw = raw.deadline ?? raw.targetDeadline;
      if (typeof deadlineRaw === 'string' && deadlines.includes(deadlineRaw)) {
        base.deadline = deadlineRaw;
      }
      continue;
    }

    if (step.uiKind === 'context') {
      const allowed = optionValuesForStep(step);
      if (typeof raw[key] === 'string' && allowed.includes(raw[key])) {
        base[key] = raw[key];
      } else if (
        typeof raw.currentJob === 'string' &&
        allowed.includes(raw.currentJob)
      ) {
        base[key] = raw.currentJob;
      } else {
        base[key] = '';
      }
      const freqs = (step.secondaryOptions ?? []).map((o) => o.value);
      const freqRaw = raw.useFrequency ?? raw.currentContextFrequency;
      if (typeof freqRaw === 'string' && freqs.includes(freqRaw)) {
        base.useFrequency = freqRaw;
      }
      if (step.allowOther) {
        const other = trimOther(raw[otherKey] ?? raw.currentJobOther);
        if (other) base[otherKey] = other;
      }
      continue;
    }

    if (step.uiKind === 'confidence-barriers') {
      const confAllowed = optionValuesForStep(step);
      const confRaw = raw.confidence ?? raw.confidenceLevel;
      if (typeof confRaw === 'string' && confAllowed.includes(confRaw)) {
        base.confidence = confRaw;
      }
      const barrierAllowed = (step.secondaryOptions ?? []).map((o) => o.value);
      if (isStringArray(raw[key])) {
        base[key] = filterKnown(raw[key], barrierAllowed);
      } else if (isStringArray(raw.quitReasons)) {
        base[key] = filterKnown(raw.quitReasons, barrierAllowed);
      } else {
        base[key] = [];
      }
      if (step.allowOther) {
        const other = trimOther(raw[otherKey] ?? raw.quitReasonsOther);
        if (other) base[otherKey] = other;
      }
      continue;
    }

    const allowed = optionValuesForStep(step);
    if (step.selection === 'multi') {
      if (isStringArray(raw[key])) {
        base[key] = filterKnown(raw[key], allowed);
      } else if (typeof raw[key] === 'string' && allowed.includes(raw[key])) {
        base[key] = [raw[key]];
      } else {
        base[key] = [];
      }
    } else if (typeof raw[key] === 'string' && allowed.includes(raw[key])) {
      base[key] = raw[key];
    } else if (isStringArray(raw[key]) && raw[key].length === 1) {
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
      const daysAllowed = (step.scheduleDays ?? []).map((d) => d.toLowerCase());
      const timesAllowed = (step.scheduleTimes ?? []).map((t) => t.value);
      assertAllowed(`${key}.days`, schedule.days, daysAllowed);
      assertAllowed(`${key}.times`, schedule.times, timesAllowed);
      continue;
    }

    if (step.uiKind === 'skill-evidence') {
      const evidence = asSkillEvidence(answers, key);
      const exposureAllowed = (step.exposureOptions ?? []).map((o) => o.value);
      for (const item of evidence) {
        if (
          exposureAllowed.length &&
          !exposureAllowed.includes(item.exposureLevel)
        ) {
          throw new AppException(
            AuthErrorCode.VALIDATION_ERROR,
            `Invalid exposure for ${item.skillSlug}`,
            HttpStatus.BAD_REQUEST,
          );
        }
      }
      continue;
    }

    if (step.uiKind === 'track-select') {
      const track = asTrackSelection(answers, key);
      const allowed = optionValuesForStep(step);
      if (track.primary) assertAllowed(key, [track.primary], allowed);
      if (track.secondary.length) {
        assertAllowed(`${key}.secondary`, track.secondary, allowed);
      }
      continue;
    }

    if (step.uiKind === 'outcome') {
      const allowed = optionValuesForStep(step);
      const value = asString(answers, key);
      if (value) assertAllowed(key, [value], allowed);
      const deadlines = (step.secondaryOptions ?? []).map((o) => o.value);
      const deadline = asString(answers, 'deadline');
      if (deadline) assertAllowed('deadline', [deadline], deadlines);
      continue;
    }

    if (step.uiKind === 'context') {
      const allowed = optionValuesForStep(step);
      const value = asString(answers, key);
      if (value) assertAllowed(key, [value], allowed);
      const freqs = (step.secondaryOptions ?? []).map((o) => o.value);
      const freq = asString(answers, 'useFrequency');
      if (freq) assertAllowed('useFrequency', [freq], freqs);
      continue;
    }

    if (step.uiKind === 'confidence-barriers') {
      const confAllowed = optionValuesForStep(step);
      const conf = asString(answers, 'confidence');
      if (conf) assertAllowed('confidence', [conf], confAllowed);
      const barrierAllowed = (step.secondaryOptions ?? []).map((o) => o.value);
      const barriers = asStringArray(answers, key);
      if (barriers.length) assertAllowed(key, barriers, barrierAllowed);
      continue;
    }

    const allowed = optionValuesForStep(step);
    const other = asString(answers, `${key}Other`).trim();

    if (step.selection === 'multi') {
      const values = asStringArray(answers, key);
      if (values.length) assertAllowed(key, values, allowed);
      continue;
    }

    const value = asString(answers, key);
    if (value) assertAllowed(key, [value], allowed);
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

    if (step.uiKind === 'skill-evidence') {
      // Empty skill list is valid (no prior skills).
      continue;
    }

    if (step.uiKind === 'track-select') {
      const track = asTrackSelection(answers, key);
      if (!track.primary) missing.push(key);
      continue;
    }

    if (step.uiKind === 'capacity') {
      if (!asString(answers, key)) missing.push(key);
      if (!asString(answers, 'preferredSessionMinutes')) {
        missing.push('preferredSessionMinutes');
      }
      continue;
    }

    if (step.uiKind === 'outcome') {
      if (!asString(answers, key)) missing.push(key);
      if (!asString(answers, 'deadline')) missing.push('deadline');
      continue;
    }

    if (step.uiKind === 'context') {
      const other = asString(answers, `${key}Other`).trim();
      if (!asString(answers, key) && !other) missing.push(key);
      if (!asString(answers, 'useFrequency')) missing.push('useFrequency');
      continue;
    }

    if (step.uiKind === 'confidence-barriers') {
      if (!asString(answers, 'confidence')) missing.push('confidence');
      // Barriers optional but recommended — require at least one.
      if (!asStringArray(answers, key).length) missing.push(key);
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

export { sanitizeFreeSkillValues, isFreeSkillToken };
