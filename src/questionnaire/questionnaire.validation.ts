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
  emptyQuestionnaireAnswers,
  type QuestionnaireAnswers,
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

function assertNonEmpty(field: string, values: string[]) {
  if (!values.length) {
    throw new AppException(
      AuthErrorCode.VALIDATION_ERROR,
      `${field} requires at least one selection`,
      HttpStatus.BAD_REQUEST,
    );
  }
}

function filterKnown(values: string[], allowed: readonly string[]) {
  return values.filter((v) => allowed.includes(v));
}

function getStep(
  schema: QuestionnaireSchemaDto,
  fieldKey: string,
): QuestionnaireStepDto | undefined {
  return schema.steps.find((s) => s.id === fieldKey);
}

function optionValuesForStep(
  schema: QuestionnaireSchemaDto,
  fieldKey: string,
): string[] {
  const step = getStep(schema, fieldKey);
  if (!step) return [];
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
  const goalAllowed = optionValuesForStep(schema, 'goal');
  const motivationAllowed = optionValuesForStep(schema, 'motivation');
  const currentJobAllowed = optionValuesForStep(schema, 'currentJob');
  const skillsAllowed = optionValuesForStep(schema, 'skills');
  const studyHoursAllowed = optionValuesForStep(schema, 'studyHours');
  const deadlineAllowed = optionValuesForStep(schema, 'deadline');
  const learningStyleAllowed = optionValuesForStep(schema, 'learningStyle');
  const confidenceAllowed = optionValuesForStep(schema, 'confidence');
  const quitReasonsAllowed = optionValuesForStep(schema, 'quitReasons');

  const scheduleStep = getStep(schema, 'schedule');
  const scheduleDays = scheduleStep?.scheduleDays ?? [];
  const scheduleTimes = (scheduleStep?.scheduleTimes ?? []).map((t) => t.value);

  if (isStringArray(raw.goal)) {
    base.goal = filterKnown(raw.goal, goalAllowed);
  }
  if (isStringArray(raw.motivation)) {
    base.motivation = filterKnown(raw.motivation, motivationAllowed);
  }
  const motivationOther = trimOther(raw.motivationOther);
  if (motivationOther) base.motivationOther = motivationOther;

  if (
    typeof raw.currentJob === 'string' &&
    currentJobAllowed.includes(raw.currentJob)
  ) {
    base.currentJob = raw.currentJob;
  }
  const currentJobOther = trimOther(raw.currentJobOther);
  if (currentJobOther) base.currentJobOther = currentJobOther;

  if (isStringArray(raw.skills)) {
    base.skills = filterKnown(raw.skills, skillsAllowed);
  }
  const skillsOther = trimOther(raw.skillsOther);
  if (skillsOther) base.skillsOther = skillsOther;

  if (
    typeof raw.studyHours === 'string' &&
    studyHoursAllowed.includes(raw.studyHours)
  ) {
    base.studyHours = raw.studyHours;
  }

  if (raw.schedule && typeof raw.schedule === 'object') {
    const schedule = raw.schedule as Record<string, unknown>;
    base.schedule = {
      days: isStringArray(schedule.days)
        ? filterKnown(schedule.days, scheduleDays)
        : [],
      times: isStringArray(schedule.times)
        ? filterKnown(schedule.times, scheduleTimes)
        : [],
    };
  }

  if (
    typeof raw.deadline === 'string' &&
    deadlineAllowed.includes(raw.deadline)
  ) {
    base.deadline = raw.deadline;
  }

  if (isStringArray(raw.learningStyle)) {
    base.learningStyle = filterKnown(raw.learningStyle, learningStyleAllowed);
  }
  const learningStyleOther = trimOther(raw.learningStyleOther);
  if (learningStyleOther) base.learningStyleOther = learningStyleOther;

  if (
    typeof raw.confidence === 'string' &&
    confidenceAllowed.includes(raw.confidence)
  ) {
    base.confidence = raw.confidence;
  }

  if (isStringArray(raw.quitReasons)) {
    base.quitReasons = filterKnown(raw.quitReasons, quitReasonsAllowed);
  }
  const quitReasonsOther = trimOther(raw.quitReasonsOther);
  if (quitReasonsOther) base.quitReasonsOther = quitReasonsOther;

  return base;
}

/** Strict validation for final submit (visible steps only — Question Engine branching). */
export function assertCompleteAnswers(
  input: unknown,
  schema: QuestionnaireSchemaDto,
): QuestionnaireAnswers {
  const answers = normalizeDraftAnswers(input, schema);
  const visible = (field: string) => isFieldVisible(schema, field, answers);

  if (visible('goal')) {
    assertNonEmpty('goal', answers.goal);
    assertAllowed('goal', answers.goal, optionValuesForStep(schema, 'goal'));
  }

  if (visible('motivation')) {
    assertNonEmpty('motivation', answers.motivation);
    assertAllowed(
      'motivation',
      answers.motivation,
      optionValuesForStep(schema, 'motivation'),
    );
  }

  if (visible('currentJob')) {
    if (!answers.currentJob) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'currentJob is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    assertAllowed(
      'currentJob',
      [answers.currentJob],
      optionValuesForStep(schema, 'currentJob'),
    );
    if (answers.currentJob === 'other' && !answers.currentJobOther) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'currentJobOther is required when currentJob is other',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  if (visible('skills')) {
    assertNonEmpty('skills', answers.skills);
    assertAllowed(
      'skills',
      answers.skills,
      optionValuesForStep(schema, 'skills'),
    );
    if (answers.skills.includes('none') && answers.skills.length > 1) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'skills cannot combine "none" with other values',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  if (visible('studyHours')) {
    if (!answers.studyHours) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'studyHours is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    assertAllowed(
      'studyHours',
      [answers.studyHours],
      optionValuesForStep(schema, 'studyHours'),
    );
  }

  if (visible('schedule')) {
    const scheduleStep = getStep(schema, 'schedule');
    const scheduleDays = scheduleStep?.scheduleDays ?? [];
    const scheduleTimes = (scheduleStep?.scheduleTimes ?? []).map(
      (t) => t.value,
    );

    assertNonEmpty('schedule.days', answers.schedule.days);
    assertAllowed('schedule.days', answers.schedule.days, scheduleDays);
    assertNonEmpty('schedule.times', answers.schedule.times);
    assertAllowed('schedule.times', answers.schedule.times, scheduleTimes);
  }

  if (visible('deadline')) {
    if (!answers.deadline) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'deadline is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    assertAllowed(
      'deadline',
      [answers.deadline],
      optionValuesForStep(schema, 'deadline'),
    );
  }

  if (visible('learningStyle')) {
    assertNonEmpty('learningStyle', answers.learningStyle);
    assertAllowed(
      'learningStyle',
      answers.learningStyle,
      optionValuesForStep(schema, 'learningStyle'),
    );
  }

  if (visible('confidence')) {
    if (!answers.confidence) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'confidence is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    assertAllowed(
      'confidence',
      [answers.confidence],
      optionValuesForStep(schema, 'confidence'),
    );
  }

  if (visible('quitReasons')) {
    assertNonEmpty('quitReasons', answers.quitReasons);
    assertAllowed(
      'quitReasons',
      answers.quitReasons,
      optionValuesForStep(schema, 'quitReasons'),
    );
  }

  return answers;
}

export function withOther(
  values: string[],
  other?: string,
): { values: string[]; other?: string } {
  return other ? { values, other } : { values };
}
