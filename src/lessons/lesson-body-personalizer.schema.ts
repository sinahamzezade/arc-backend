import {
  isPlayOutline,
  type LessonContentBlock,
  type LessonContentPage,
  type LessonPlayOutline,
} from './lesson-play.types';
import type {
  LessonBodyPageDraft,
  LessonBodyRewriteDraft,
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

export function parseLessonBodyRewrite(
  raw: unknown,
  allowedPageIds: Set<string>,
): LessonBodyRewriteDraft {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Lesson body rewrite must be an object');
  }
  const obj = raw as Record<string, unknown>;
  const pagesRaw = obj.pages;
  if (!Array.isArray(pagesRaw) || !pagesRaw.length) {
    throw new Error('Lesson body rewrite pages[] required');
  }

  const pages: LessonBodyPageDraft[] = [];
  for (const p of pagesRaw) {
    if (!p || typeof p !== 'object') continue;
    const page = p as Record<string, unknown>;
    const id = typeof page.id === 'string' ? page.id.trim() : '';
    if (!id || !allowedPageIds.has(id)) {
      throw new Error(`Unknown or missing page id: ${id || '(empty)'}`);
    }
    const title =
      typeof page.title === 'string' && page.title.trim()
        ? page.title.trim().slice(0, 120)
        : 'Page';
    const blocks = parseBlocks(page.blocks);
    if (!blocks.length) {
      throw new Error(`Page ${id} has no valid blocks`);
    }
    pages.push({ id, title, blocks });
  }

  if (!pages.length) {
    throw new Error('No valid rewritten pages');
  }

  const suggestedArlo = Array.isArray(obj.suggestedArlo)
    ? obj.suggestedArlo
        .filter(
          (s): s is string => typeof s === 'string' && s.trim().length > 0,
        )
        .map((s) => s.trim().slice(0, 120))
        .slice(0, 6)
    : undefined;

  return {
    objective:
      typeof obj.objective === 'string' && obj.objective.trim()
        ? obj.objective.trim().slice(0, 500)
        : undefined,
    arloPrompt:
      typeof obj.arloPrompt === 'string' && obj.arloPrompt.trim()
        ? obj.arloPrompt.trim().slice(0, 300)
        : undefined,
    suggestedArlo,
    pages,
  };
}

function parseBlocks(raw: unknown): LessonBodyPageDraft['blocks'] {
  if (!Array.isArray(raw)) return [];
  const out: LessonBodyPageDraft['blocks'] = [];
  for (const b of raw) {
    if (!b || typeof b !== 'object') continue;
    const block = b as Record<string, unknown>;
    const type = block.type;
    if (type === 'text' && typeof block.body === 'string') {
      out.push({ type: 'text', body: block.body.slice(0, 4000) });
    } else if (
      type === 'callout' &&
      typeof block.title === 'string' &&
      typeof block.body === 'string'
    ) {
      out.push({
        type: 'callout',
        title: block.title.slice(0, 120),
        body: block.body.slice(0, 2000),
      });
    } else if (
      type === 'code' &&
      typeof block.label === 'string' &&
      typeof block.code === 'string'
    ) {
      out.push({
        type: 'code',
        label: block.label.slice(0, 80),
        code: block.code.slice(0, 4000),
      });
    }
  }
  return out;
}

/**
 * Apply rewrite onto scaffold. Practice / quiz / remediation / reward frozen.
 */
export function mergeLessonBodyRewrite(
  scaffold: LessonPlayOutline,
  draft: LessonBodyRewriteDraft,
  meta: ArcPersonalizationMeta,
): LessonPlayOutline {
  const byId = new Map(draft.pages.map((p) => [p.id, p]));
  const content: LessonContentPage[] = scaffold.content.map((page) => {
    const rewritten = byId.get(page.id);
    if (!rewritten) return page;
    return {
      id: page.id,
      title: rewritten.title || page.title,
      blocks: rewritten.blocks as LessonContentBlock[],
    };
  });

  const merged: LessonPlayOutline & Record<string, unknown> = {
    ...scaffold,
    objective: draft.objective?.trim() || scaffold.objective,
    arloPrompt: draft.arloPrompt?.trim() || scaffold.arloPrompt,
    suggestedArlo:
      draft.suggestedArlo && draft.suggestedArlo.length
        ? draft.suggestedArlo
        : scaffold.suggestedArlo,
    content,
    practice: scaffold.practice,
    quiz: scaffold.quiz,
    reward: scaffold.reward,
    rewardPresentation: scaffold.rewardPresentation,
    remediation: scaffold.remediation,
    attemptBudgetPerConcept: scaffold.attemptBudgetPerConcept,
    [ARC_PERSONALIZATION_KEY]: meta,
  };

  if (!isPlayOutline(merged)) {
    throw new Error('Merged outline failed isPlayOutline validation');
  }
  return merged;
}
