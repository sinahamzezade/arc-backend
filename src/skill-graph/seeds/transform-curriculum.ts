/**
 * Curriculum JSON → LessonPlayOutline (§6.1 + §16.2).
 * Does NOT regenerate pedagogy — transforms authored content only.
 */
import {
  assertConceptTagsPresent,
  DEFAULT_ATTEMPT_BUDGET_PER_CONCEPT,
  isPlayOutline,
  type LessonContentBlock,
  type LessonPlayOutline,
  type LessonRecoveryItem,
  type LessonRemediationPool,
  type LessonRewardPresentation,
} from '../../lessons/lesson-play.types';
import {
  inappContentToPlayOutline,
  type InAppLessonContent,
} from './inapp-content.mapper';

const STOP = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'is',
  'are',
  'was',
  'were',
  'be',
  'do',
  'does',
  'did',
  'what',
  'which',
  'who',
  'how',
  'why',
  'when',
  'where',
  'your',
  'you',
  'this',
  'that',
  'these',
  'those',
  'with',
  'from',
  'into',
  'about',
  'does',
  'mean',
  'means',
  'correctly',
  'correct',
  'following',
  'statement',
  'best',
  'true',
  'false',
  'pick',
  'choose',
]);

const REWARD_CLASS_BY_TYPE: Record<string, LessonRewardPresentation['rewardClass']> =
  {
    reading: 'concept_read',
    quiz: 'knowledge_check',
    practice: 'standard_practice',
    mini_project: 'project',
    reflection: 'reflection',
    video: 'concept_read',
  };

export type TransformCurriculumInput = {
  skillSlug: string;
  lessonSlug?: string;
  title: string;
  lessonType: string;
  missionNameTemplate?: string | null;
  content?: InAppLessonContent | null;
};

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function conceptKeyword(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  const picked = words.slice(0, 3).join('-');
  return picked || 'concept';
}

export function conceptTagFor(
  skillSlug: string,
  seedText: string,
): string {
  const skill = slugify(skillSlug) || 'skill';
  const concept = conceptKeyword(seedText);
  if (!concept || concept === 'concept') return skill;
  return `${skill}:${concept}`;
}

function rewardClassFor(lessonType: string, format?: string): string {
  const key = (format || lessonType || '').toLowerCase();
  return REWARD_CLASS_BY_TYPE[key] ?? 'standard_practice';
}

function contentFormat(
  content: InAppLessonContent | null | undefined,
  lessonType: string,
): string {
  if (content && typeof content === 'object' && 'format' in content) {
    return String((content as { format?: string }).format ?? lessonType);
  }
  return lessonType;
}

function synthesizeArlo(title: string, objective: string): {
  arloPrompt: string;
  suggestedArlo: string[];
} {
  return {
    arloPrompt: `Stuck on “${title}”? Ask me to break it down.`,
    suggestedArlo: [
      `Explain “${title}” simply`,
      objective.slice(0, 80)
        ? `What does this mean: ${objective.slice(0, 72)}…`
        : 'Give me a 60-second recap',
      'Quiz me on the key idea',
    ],
  };
}

/** Light reword so recovery ≠ verbatim primary item. */
function rewordPrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (/^which\b/i.test(trimmed)) {
    return trimmed.replace(/^which\b/i, 'Pick which');
  }
  if (/^what\b/i.test(trimmed)) {
    return trimmed.replace(/^what\b/i, 'Remind me — what');
  }
  if (/^where\b/i.test(trimmed)) {
    return trimmed.replace(/^where\b/i, 'Quick check — where');
  }
  return `Quick recovery: ${trimmed}`;
}

function rewordLabel(label: string, correct: boolean): string {
  const t = label.trim();
  if (correct) {
    if (t.length < 80) return `${t} ✓`.replace(/ ✓ ✓$/, ' ✓');
    return t;
  }
  // Light non-verbatim tweak for distractors
  if (/^the\b/i.test(t)) return t.replace(/^the\b/i, 'A');
  return t.endsWith('.') ? t.slice(0, -1) : `${t}.`;
}

function buildRecoveryFromPractice(
  practice: LessonPlayOutline['practice'],
  conceptTag: string,
): LessonRecoveryItem {
  const correct = practice.options.find((o) => o.correct);
  return {
    id: `r-${slugify(conceptTag)}-1`,
    prompt: rewordPrompt(practice.prompt),
    options: practice.options.map((o) => ({
      id: o.id,
      label: rewordLabel(o.label, o.correct),
      correct: o.correct,
    })),
    explanation:
      practice.feedbackIncorrect ??
      practice.feedbackCorrect ??
      (correct
        ? `The right call is “${correct.label}”.`
        : 'Revisit the concept and try again.'),
  };
}

function buildRecoveryFromQuiz(
  q: LessonPlayOutline['quiz'][number],
  conceptTag: string,
): LessonRecoveryItem {
  return {
    id: `r-${slugify(conceptTag)}-1`,
    prompt: rewordPrompt(q.prompt),
    options: q.options.map((o) => ({
      id: o.id,
      label: rewordLabel(o.label, o.id === q.correctOptionId),
      correct: o.id === q.correctOptionId,
    })),
    explanation: q.explanation,
  };
}

function findMatchingReadingBlocks(
  outline: LessonPlayOutline,
  seedText: string,
): LessonContentBlock[] {
  const tokens = conceptKeyword(seedText).split('-').filter(Boolean);
  if (!tokens.length) return [];
  for (const page of outline.content) {
    const hay = `${page.title} ${page.blocks.map((b) => ('body' in b ? b.body : '')).join(' ')}`.toLowerCase();
    const hits = tokens.filter((t) => hay.includes(t));
    if (hits.length >= Math.min(2, tokens.length)) {
      return page.blocks.slice(0, 2);
    }
  }
  return [];
}

function buildRemediation(
  outline: LessonPlayOutline,
): Record<string, LessonRemediationPool> {
  const pools: Record<string, LessonRemediationPool> = {};

  const ensure = (
    tag: string,
    explanationText: string,
    seedText: string,
    recovery: LessonRecoveryItem,
  ) => {
    if (pools[tag]) return;
    const reading = findMatchingReadingBlocks(outline, seedText);
    const micro: LessonContentBlock[] = [];
    if (reading.length) {
      micro.push(...reading.slice(0, 1));
    }
    micro.push({
      type: 'text',
      body: explanationText,
    });
    // Guarantee recovery differs from primary prompt text
    if (recovery.prompt === seedText) {
      recovery = { ...recovery, prompt: rewordPrompt(recovery.prompt) };
    }
    pools[tag] = {
      microExplanation: micro,
      recoveryItems: [recovery],
    };
  };

  const p = outline.practice;
  if (p?.conceptTag) {
    ensure(
      p.conceptTag,
      p.feedbackIncorrect ?? p.feedbackCorrect ?? outline.objective,
      p.prompt,
      buildRecoveryFromPractice(p, p.conceptTag),
    );
  }

  for (const q of outline.quiz ?? []) {
    if (!q.conceptTag) continue;
    ensure(
      q.conceptTag,
      q.explanation || outline.objective,
      q.prompt,
      buildRecoveryFromQuiz(q, q.conceptTag),
    );
  }

  return pools;
}

/**
 * Transform one curriculum lesson into a full play outline (§6.1 + §16.2).
 * Throws if any practice/quiz item lacks conceptTag.
 */
export function transformCurriculumLesson(
  input: TransformCurriculumInput,
): LessonPlayOutline {
  const format = contentFormat(input.content, input.lessonType);
  const base = inappContentToPlayOutline({
    title: input.title,
    missionNameTemplate: input.missionNameTemplate,
    lessonType: input.lessonType,
    content: input.content,
  });

  const objective =
    base.objective ||
    (input.content &&
    typeof input.content === 'object' &&
    'objective' in input.content &&
    typeof (input.content as { objective?: unknown }).objective === 'string'
      ? (input.content as { objective: string }).objective
      : `Learn “${input.title}”`);

  const arlo = synthesizeArlo(input.title, objective);

  const practiceTag = conceptTagFor(
    input.skillSlug,
    `${base.practice.prompt} ${input.title}`,
  );
  const practice: LessonPlayOutline['practice'] = {
    ...base.practice,
    conceptTag: practiceTag,
  };

  const quiz: LessonPlayOutline['quiz'] = (base.quiz ?? []).map((q) => ({
    ...q,
    conceptTag: conceptTagFor(input.skillSlug, `${q.prompt} ${input.title}`),
  }));

  // practice / mini_project / reflection may omit quiz (§ Task 1)
  const allowEmptyQuiz = ['practice', 'mini_project', 'reflection'].includes(
    format,
  );
  const quizOut = allowEmptyQuiz && quiz.length === 1 && quiz[0]?.id === 'q1'
    ? // drop synthesised stub quiz for non-quiz modalities when only stub present
      []
    : quiz;

  // If we dropped quiz and practice is a completion-ack, still keep practice tagged
  const outline: LessonPlayOutline = {
    objective,
    arloPrompt: base.arloPrompt || arlo.arloPrompt,
    suggestedArlo:
      base.suggestedArlo?.length >= 3
        ? base.suggestedArlo.slice(0, 3)
        : arlo.suggestedArlo,
    content: base.content,
    practice,
    quiz: quizOut.length ? quizOut : allowEmptyQuiz ? [] : quiz,
    reward: base.reward,
    rewardPresentation: {
      rewardClass: rewardClassFor(input.lessonType, format),
      arloLine: base.reward?.arloLine,
      badgeCandidateKey: null,
    },
    attemptBudgetPerConcept: DEFAULT_ATTEMPT_BUDGET_PER_CONCEPT,
  };

  outline.remediation = buildRemediation(outline);
  assertConceptTagsPresent(outline);

  if (!isPlayOutline(outline)) {
    throw new Error(
      `Transform produced invalid play outline for “${input.title}”`,
    );
  }

  return outline;
}

/** Validate outline for seed — fails hard on missing conceptTag (§16.8). */
export function validateTransformedOutline(outline: LessonPlayOutline): void {
  if (!isPlayOutline(outline)) {
    throw new Error('Invalid play outline shape');
  }
  assertConceptTagsPresent(outline);
  for (const tag of collectConceptTags(outline)) {
    const pool = outline.remediation?.[tag];
    if (!pool?.recoveryItems?.length) {
      // Soft: degrade at runtime; seed still OK if tag present
      continue;
    }
    const primaryPrompts = new Set<string>([
      outline.practice.conceptTag === tag ? outline.practice.prompt : '',
      ...outline.quiz
        .filter((q) => q.conceptTag === tag)
        .map((q) => q.prompt),
    ]);
    for (const item of pool.recoveryItems) {
      if (primaryPrompts.has(item.prompt)) {
        throw new Error(
          `Seed validation failed: recovery item "${item.id}" is verbatim copy of primary for ${tag}`,
        );
      }
    }
  }
}

export function collectConceptTags(outline: LessonPlayOutline): string[] {
  const tags = new Set<string>();
  if (outline.practice?.conceptTag) tags.add(outline.practice.conceptTag);
  for (const q of outline.quiz ?? []) {
    if (q.conceptTag) tags.add(q.conceptTag);
  }
  return [...tags];
}
