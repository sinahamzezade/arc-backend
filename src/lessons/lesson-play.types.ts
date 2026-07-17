/**
 * Authoritative lesson play payload stored in lessons.play_content.
 * Snapshotted from units.content at roadmap materialization time.
 */

export type UnitLessonType =
  | 'reading'
  | 'practice'
  | 'mini_project'
  | 'interactive'
  | 'quiz'
  | 'video'
  | 'scenario'
  | 'visual_hotspot'
  | 'debate'
  | 'sandbox_simulation';

export const ACTIVE_LESSON_TYPES = [
  'scenario',
  'visual_hotspot',
  'debate',
  'sandbox_simulation',
] as const satisfies ReadonlyArray<UnitLessonType>;

export type ActiveLessonType = (typeof ACTIVE_LESSON_TYPES)[number];

export type ScenarioOption = {
  id: string;
  label: string;
};

export type Hotspot = {
  id: string;
  label?: string;
  /** Normalized 0–1 coords for FE tap targets (public). */
  x?: number;
  y?: number;
};

export type DragItem = {
  id: string;
  label: string;
};

/** Domain-neutral active + narration blocks inside active-format play bodies. */
export type ActiveLessonBlock =
  | { type: 'text'; id: string; body: string }
  | { type: 'callout'; id: string; title: string; body: string }
  | { type: 'live_context'; id: string; track_tag: string }
  | {
      type: 'scenario_decision';
      id: string;
      setup: string;
      options: ScenarioOption[];
      /** SECRET — withheld until check. */
      correctOptionId: string;
      /** SECRET — outcome copy keyed by option id. */
      outcomes?: Record<string, string>;
    }
  | {
      type: 'visual_hotspot';
      id: string;
      imageAssetKey: string;
      hotspots: Hotspot[];
      /** SECRET */
      correctHotspotId: string;
      /** SECRET */
      explanation?: string;
    }
  | {
      type: 'drag_order';
      id: string;
      items: DragItem[];
      /** SECRET — server-side order hash (sha256 of id joined by `|`). */
      correctOrderHash: string;
      /** SECRET — canonical ordered ids for grading/replay. */
      correctOrder?: string[];
      explanation?: string;
    }
  | {
      type: 'debate_pick';
      id: string;
      prompt: string;
      sideA: string;
      sideB: string;
      /** SECRET — preferred side when graded (`a` | `b`); omit for open debate. */
      preferredSide?: 'a' | 'b';
      /** SECRET */
      feedbackA?: string;
      /** SECRET */
      feedbackB?: string;
    }
  | {
      type: 'sandbox_simulation';
      id: string;
      simulationAssetKey: string;
      actions: string[];
      /** SECRET — winning action sequence. */
      correctActions: string[];
      /** SECRET */
      outcomeCopy?: string;
    };

/** scenario | visual_hotspot | debate | sandbox_simulation play body. */
export type ActiveFormatPlayContent = {
  objective: string;
  blocks: ActiveLessonBlock[];
};

/** Structured reading section (course-authoring v2). */
export type ReadingSectionBlock = {
  type: 'text' | 'callout' | 'code';
  body?: string;
  title?: string;
  code?: string;
  label?: string;
};

export type ReadingSection = {
  id: string;
  title: string;
  blocks: ReadingSectionBlock[];
};

/**
 * Reading body. `sections` may be legacy `string[]` or structured
 * `{ id, title, blocks[] }[]` (both accepted by isUnitPlayContent).
 */
export type ReadingPlayContent = {
  objective: string;
  sections: Array<string | ReadingSection>;
  keyTakeaways: string[];
};

/** practice | mini_project | interactive */
export type TaskPlayContent = {
  objective: string;
  task: string;
  acceptanceCriteria: string[];
  hints?: string[];
  starterHtml?: string;
};

export type QuizQuestion = {
  /** Normalized to `q0`, `q1`, ... at materialization; may be absent on raw seeds. */
  id?: string;
  q: string;
  type: 'mcq' | 'boolean';
  options?: string[];
  /** SECRET — option index for mcq, boolean for boolean. Never on public play body. */
  answer: number | boolean;
  /** SECRET — revealed only after a check. */
  explain?: string;
};

export type QuizPlayContent = {
  objective: string;
  passScore: number;
  questions: QuizQuestion[];
};

export type VideoPlayContent = {
  objective: string;
  note: string;
};

export type UnitPlayContent =
  | ReadingPlayContent
  | TaskPlayContent
  | QuizPlayContent
  | VideoPlayContent
  | ActiveFormatPlayContent;

export function isReadingContent(
  value: UnitPlayContent,
): value is ReadingPlayContent {
  return Array.isArray((value as ReadingPlayContent).sections);
}

export function isTaskContent(
  value: UnitPlayContent,
): value is TaskPlayContent {
  return typeof (value as TaskPlayContent).task === 'string';
}

export function isQuizContent(
  value: UnitPlayContent,
): value is QuizPlayContent {
  return Array.isArray((value as QuizPlayContent).questions);
}

export function isVideoContent(
  value: UnitPlayContent,
): value is VideoPlayContent {
  return (
    typeof (value as VideoPlayContent).note === 'string' &&
    !isReadingContent(value) &&
    !isTaskContent(value) &&
    !isQuizContent(value) &&
    !isActiveFormatContent(value)
  );
}

export function isActiveFormatContent(
  value: UnitPlayContent,
): value is ActiveFormatPlayContent {
  return Array.isArray((value as ActiveFormatPlayContent).blocks);
}

function isValidQuizQuestion(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const q = value as Record<string, unknown>;
  if (typeof q.q !== 'string') return false;
  if (q.type === 'mcq') {
    return Array.isArray(q.options) && typeof q.answer === 'number';
  }
  if (q.type === 'boolean') {
    return typeof q.answer === 'boolean';
  }
  return false;
}

function isReadingSectionBlock(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const b = value as Record<string, unknown>;
  if (b.type !== 'text' && b.type !== 'callout' && b.type !== 'code') {
    return false;
  }
  if (b.body !== undefined && typeof b.body !== 'string') return false;
  if (b.title !== undefined && typeof b.title !== 'string') return false;
  if (b.code !== undefined && typeof b.code !== 'string') return false;
  if (b.label !== undefined && typeof b.label !== 'string') return false;
  return true;
}

function isReadingSection(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const s = value as Record<string, unknown>;
  if (typeof s.id !== 'string' || typeof s.title !== 'string') return false;
  if (!Array.isArray(s.blocks)) return false;
  return s.blocks.every(isReadingSectionBlock);
}

function isValidReadingSections(sections: unknown[]): boolean {
  if (!sections.length) return false;
  return sections.every((s) => typeof s === 'string' || isReadingSection(s));
}

/** True for any valid type-specific unit play body. */
export function isUnitPlayContent(value: unknown): value is UnitPlayContent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  if (typeof v.objective !== 'string') return false;

  // reading — string[] (legacy) or structured {id,title,blocks[]}[]
  if (Array.isArray(v.sections)) {
    return isValidReadingSections(v.sections) && Array.isArray(v.keyTakeaways);
  }
  // practice / mini_project / interactive
  if (typeof v.task === 'string') {
    return Array.isArray(v.acceptanceCriteria);
  }
  // quiz
  if (Array.isArray(v.questions)) {
    return (
      typeof v.passScore === 'number' &&
      v.questions.length > 0 &&
      v.questions.every((q) => isValidQuizQuestion(q))
    );
  }
  // active formats (scenario / visual_hotspot / debate / sandbox_simulation)
  if (Array.isArray(v.blocks)) {
    return v.blocks.length > 0 && v.blocks.every(isValidActiveBlock);
  }
  // video
  return typeof v.note === 'string';
}

function isValidActiveBlock(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const b = value as Record<string, unknown>;
  if (typeof b.id !== 'string' || typeof b.type !== 'string') return false;
  switch (b.type) {
    case 'text':
      return typeof b.body === 'string';
    case 'callout':
      return typeof b.title === 'string' && typeof b.body === 'string';
    case 'live_context':
      return typeof b.track_tag === 'string';
    case 'scenario_decision':
      return (
        typeof b.setup === 'string' &&
        Array.isArray(b.options) &&
        b.options.length > 0 &&
        typeof b.correctOptionId === 'string'
      );
    case 'visual_hotspot':
      return (
        typeof b.imageAssetKey === 'string' &&
        Array.isArray(b.hotspots) &&
        b.hotspots.length > 0 &&
        typeof b.correctHotspotId === 'string'
      );
    case 'drag_order':
      return (
        Array.isArray(b.items) &&
        b.items.length > 0 &&
        typeof b.correctOrderHash === 'string'
      );
    case 'debate_pick':
      return (
        typeof b.prompt === 'string' &&
        typeof b.sideA === 'string' &&
        typeof b.sideB === 'string'
      );
    case 'sandbox_simulation':
      return (
        typeof b.simulationAssetKey === 'string' &&
        Array.isArray(b.actions) &&
        Array.isArray(b.correctActions)
      );
    default:
      return false;
  }
}

/**
 * Assign stable index-based ids (`q0`, `q1`, ...) to quiz questions that
 * lack one. Idempotent — call at materialization AND defensively on read.
 */
export function normalizeUnitPlayContent(
  content: UnitPlayContent,
): UnitPlayContent {
  if (!isQuizContent(content)) return content;
  return {
    ...content,
    questions: content.questions.map((q, i) => ({
      ...q,
      id: q.id?.trim() || `q${i}`,
    })),
  };
}

/** Keys that must never appear on GET /play public body. */
export const PLAY_SECRET_KEYS = [
  'answer',
  'explain',
  // legacy outline keys — kept so old snapshots stay safe too
  'correct',
  'correctOptionId',
  'explanation',
  'feedbackIncorrect',
  'remediation',
  'badgeCandidateKey',
  // active-format secrets
  'correctHotspotId',
  'correctOrderHash',
  'correctOrder',
  'correctActions',
  'outcomes',
  'preferredSide',
  'feedbackA',
  'feedbackB',
  'outcomeCopy',
] as const;

/**
 * Deep-copy `content` with every secret key removed (answer/explain on quiz
 * questions plus any legacy grading keys).
 */
export function stripPlaySecrets<T>(content: T): T {
  return stripSecretKeysDeep(content) as T;
}

function stripSecretKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripSecretKeysDeep(item));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if ((PLAY_SECRET_KEYS as readonly string[]).includes(k)) continue;
      out[k] = stripSecretKeysDeep(v);
    }
    return out;
  }
  return value;
}

/** Test/guard helper — list paths of any secret keys present in a payload. */
export function collectSecretKeyHits(value: unknown, path = ''): string[] {
  const hits: string[] = [];
  if (value == null) return hits;
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      hits.push(...collectSecretKeyHits(item, `${path}[${i}]`));
    });
    return hits;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const next = path ? `${path}.${k}` : k;
      if ((PLAY_SECRET_KEYS as readonly string[]).includes(k)) {
        hits.push(next);
      }
      hits.push(...collectSecretKeyHits(v, next));
    }
  }
  return hits;
}

/* ------------------------------------------------------------------ */
/* LEGACY outline types (pre-flattened-units).                         */
/* Kept only so seed transforms / legacy assembler / remediation keep  */
/* compiling. Play APIs no longer consume these.                       */
/* ------------------------------------------------------------------ */

export type LessonContentBlock =
  | { type: 'text'; body: string }
  | { type: 'callout'; title: string; body: string }
  | { type: 'code'; label: string; code: string }
  | ActiveLessonBlock;

export type LessonContentPage = {
  id: string;
  title: string;
  blocks: LessonContentBlock[];
};

export type LessonPracticeOutline = {
  id: string;
  prompt: string;
  hint: string;
  conceptTag?: string;
  options: Array<{ id: string; label: string; correct: boolean }>;
  feedbackCorrect?: string;
  feedbackIncorrect?: string;
};

export type LessonQuizQuestionOutline = {
  id: string;
  prompt: string;
  conceptTag?: string;
  options: Array<{ id: string; label: string }>;
  correctOptionId: string;
  explanation: string;
};

export type LessonRecoveryItem = {
  id: string;
  prompt: string;
  options: Array<{ id: string; label: string; correct?: boolean }>;
  explanation: string;
};

export type LessonRemediationPool = {
  microExplanation: LessonContentBlock[];
  recoveryItems: LessonRecoveryItem[];
};

export type LessonRewardPresentation = {
  rewardClass:
    | 'concept_read'
    | 'knowledge_check'
    | 'standard_practice'
    | 'project'
    | 'reflection'
    | string;
  arloLine?: string;
  badgeCandidateKey?: string | null;
};

export type LessonRewardOutline = {
  gems?: number;
  coins?: number;
  arloLine?: string;
  badgeId?: string | null;
  badgeLabel?: string | null;
};

/** @deprecated legacy pages/blocks outline — replaced by UnitPlayContent. */
export type LessonPlayOutline = {
  objective: string;
  arloPrompt: string;
  suggestedArlo: string[];
  content: LessonContentPage[];
  practice: LessonPracticeOutline;
  quiz: LessonQuizQuestionOutline[];
  reward?: LessonRewardOutline;
  rewardPresentation?: LessonRewardPresentation;
  remediation?: Record<string, LessonRemediationPool>;
  attemptBudgetPerConcept?: number;
};

export const DEFAULT_ATTEMPT_BUDGET_PER_CONCEPT = 2;

/** @deprecated legacy outline guard — use isUnitPlayContent. */
export function isPlayOutline(value: unknown): value is LessonPlayOutline {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.objective === 'string' &&
    typeof v.arloPrompt === 'string' &&
    Array.isArray(v.content) &&
    v.content.length > 0 &&
    typeof v.practice === 'object' &&
    v.practice !== null &&
    Array.isArray(v.quiz)
  );
}

/** @deprecated seed gate for legacy outlines. */
export function assertConceptTagsPresent(outline: LessonPlayOutline): void {
  if (!outline.practice?.conceptTag?.trim()) {
    throw new Error(
      `Seed validation failed: practice "${outline.practice?.id ?? '?'}" missing conceptTag`,
    );
  }
  for (const q of outline.quiz ?? []) {
    if (!q.conceptTag?.trim()) {
      throw new Error(
        `Seed validation failed: quiz "${q.id}" missing conceptTag`,
      );
    }
  }
}
