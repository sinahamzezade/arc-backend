import {
  isQuizContent,
  isReadingContent,
  isTaskContent,
  isUnitPlayContent,
  isVideoContent,
  type UnitPlayContent,
} from './lesson-play.types';
import type {
  LessonBodyRewriteDraft,
  LessonBodySafeFields,
} from './lesson-body-personalizer.prompt';

export const ARC_PERSONALIZATION_KEY = '_arcPersonalization';

export type ArcPersonalizationMeta = {
  source: 'llm';
  model: string;
  promptVersion: string;
  at: string;
};

export function isAlreadyPersonalized(playContent: unknown): boolean {
  if (!playContent || typeof playContent !== 'object') return false;
  const meta = (playContent as Record<string, unknown>)[
    ARC_PERSONALIZATION_KEY
  ];
  return Boolean(meta && typeof meta === 'object');
}

/**
 * Extract the rewrite-safe fields for a unit body. Everything else
 * (questions, answers, acceptanceCriteria, keyTakeaways, starterHtml, urls)
 * stays server-side and frozen.
 */
export function extractSafeFields(content: UnitPlayContent): LessonBodySafeFields {
  if (isReadingContent(content)) {
    // Structured sections stay frozen — personalizer only rewrites string[] copy.
    if (content.sections.every((s): s is string => typeof s === 'string')) {
      return { objective: content.objective, sections: content.sections };
    }
    return { objective: content.objective };
  }
  if (isTaskContent(content)) {
    return {
      objective: content.objective,
      task: content.task,
      ...(content.hints?.length ? { hints: content.hints } : {}),
    };
  }
  if (isQuizContent(content)) {
    return { objective: content.objective };
  }
  if (isVideoContent(content)) {
    return { objective: content.objective, note: content.note };
  }
  // Active formats — only objective is rewrite-safe; blocks stay frozen.
  return { objective: content.objective };
}

/** Validate the LLM rewrite against the original safe fields. */
export function parseLessonBodyRewrite(
  raw: unknown,
  original: LessonBodySafeFields,
): LessonBodyRewriteDraft {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Lesson body rewrite must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const draft: LessonBodyRewriteDraft = {};

  if (typeof obj.objective === 'string' && obj.objective.trim()) {
    draft.objective = obj.objective.trim().slice(0, 500);
  }

  if (original.sections) {
    const sections = asTrimmedStrings(obj.sections, 4000);
    if (sections) {
      if (sections.length !== original.sections.length) {
        throw new Error(
          `Rewrite must keep ${original.sections.length} sections, got ${sections.length}`,
        );
      }
      draft.sections = sections;
    }
  }

  if (original.task !== undefined && typeof obj.task === 'string') {
    const task = obj.task.trim().slice(0, 4000);
    if (task) draft.task = task;
  }

  if (original.hints) {
    const hints = asTrimmedStrings(obj.hints, 500);
    if (hints) {
      if (hints.length !== original.hints.length) {
        throw new Error(
          `Rewrite must keep ${original.hints.length} hints, got ${hints.length}`,
        );
      }
      draft.hints = hints;
    }
  }

  if (original.note !== undefined && typeof obj.note === 'string') {
    const note = obj.note.trim().slice(0, 2000);
    if (note) draft.note = note;
  }

  if (Object.keys(draft).length === 0) {
    throw new Error('Rewrite contained no usable safe fields');
  }
  return draft;
}

function asTrimmedStrings(value: unknown, maxLen: number): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim().slice(0, maxLen));
  return out.length ? out : null;
}

/**
 * Apply rewrite onto the original body. Questions/answers, passScore,
 * acceptanceCriteria, keyTakeaways and starterHtml are always preserved
 * from the original — the draft cannot touch them.
 */
export function mergeLessonBodyRewrite(
  original: UnitPlayContent,
  draft: LessonBodyRewriteDraft,
  meta: ArcPersonalizationMeta,
): UnitPlayContent {
  const merged: Record<string, unknown> = {
    ...(original as unknown as Record<string, unknown>),
    objective: draft.objective?.trim() || original.objective,
    [ARC_PERSONALIZATION_KEY]: meta,
  };

  if (isReadingContent(original) && draft.sections) {
    merged.sections = draft.sections;
    merged.keyTakeaways = original.keyTakeaways;
  }
  if (isTaskContent(original)) {
    if (draft.task) merged.task = draft.task;
    if (draft.hints && original.hints) merged.hints = draft.hints;
    merged.acceptanceCriteria = original.acceptanceCriteria;
    if (original.starterHtml !== undefined) {
      merged.starterHtml = original.starterHtml;
    }
  }
  if (isQuizContent(original)) {
    merged.passScore = original.passScore;
    merged.questions = original.questions;
  }
  if (isVideoContent(original) && draft.note) {
    merged.note = draft.note;
  }

  const result = merged as unknown as UnitPlayContent;
  if (!isUnitPlayContent(result)) {
    throw new Error('Merged body failed isUnitPlayContent validation');
  }
  return result;
}
