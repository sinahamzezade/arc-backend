import { createHash } from 'crypto';
import type { QuizQuestion } from '../lessons/lesson-play.types';
import type { Unit } from './entities/unit.entity';

/** DNS namespace UUID bytes — stable across deploys for exposure tracking. */
const BATTLE_UNIT_NS = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex');

/** Flattened quiz-unit question ready for battle snapshot / selection. */
export type UnitBattlePoolItem = {
  unitId: string;
  questionIndex: number;
  stack: string;
  skillsTaught: string[];
  questionTemplateId: string;
  questionVersionId: string;
  version: number;
  questionType: string;
  difficulty: string;
  difficultyScore: number;
  estimatedSeconds: number;
  prompt: Record<string, unknown>;
  options: Array<{ id: string; label: string }>;
  correctOptionIds: string[];
  explanation: string;
  calibrationKey: string;
};

export function uuidV5FromName(name: string): string {
  const hash = createHash('sha1');
  hash.update(BATTLE_UNIT_NS);
  hash.update(name);
  const bytes = Buffer.from(hash.digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function battleUnitTemplateId(unitId: string): string {
  return uuidV5FromName(`battle-unit:${unitId}`);
}

export function battleUnitQuestionVersionId(
  unitId: string,
  questionIndex: number,
): string {
  return uuidV5FromName(`battle-unit:${unitId}:${questionIndex}`);
}

export function levelToDifficulty(level: number): {
  difficulty: 'easy' | 'medium' | 'hard' | 'expert';
  difficultyScore: number;
} {
  if (level <= 1) return { difficulty: 'easy', difficultyScore: 0.25 };
  if (level === 2) return { difficulty: 'medium', difficultyScore: 0.5 };
  if (level === 3) return { difficulty: 'hard', difficultyScore: 0.75 };
  return { difficulty: 'expert', difficultyScore: 1 };
}

function isQuizQuestion(value: unknown): value is QuizQuestion {
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

/** Extract valid quiz questions from unit.content (skips malformed items). */
export function extractQuizQuestions(
  content: Record<string, unknown>,
): QuizQuestion[] {
  const raw = content?.questions;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isQuizQuestion);
}

export function mapQuizQuestionToSnapshot(
  unit: Pick<
    Unit,
    'id' | 'level' | 'estimatedMinutes' | 'stack' | 'skillsTaught'
  >,
  question: QuizQuestion,
  questionIndex: number,
  secondsPerQuestion = 30,
): UnitBattlePoolItem | null {
  const { difficulty, difficultyScore } = levelToDifficulty(unit.level ?? 1);
  let options: Array<{ id: string; label: string }>;
  let correctOptionIds: string[];

  if (question.type === 'mcq') {
    const labels = question.options ?? [];
    if (!labels.length) return null;
    const answerIdx = question.answer;
    if (
      typeof answerIdx !== 'number' ||
      answerIdx < 0 ||
      answerIdx >= labels.length
    ) {
      return null;
    }
    options = labels.map((label, i) => ({ id: `o${i}`, label }));
    correctOptionIds = [`o${answerIdx}`];
  } else {
    options = [
      { id: 'o0', label: 'True' },
      { id: 'o1', label: 'False' },
    ];
    correctOptionIds = [question.answer === true ? 'o0' : 'o1'];
  }

  const estimatedSeconds = Math.max(
    15,
    Math.min(
      60,
      secondsPerQuestion ||
        Math.round(((unit.estimatedMinutes ?? 10) * 60) / 10),
    ),
  );

  return {
    unitId: unit.id,
    questionIndex,
    stack: unit.stack,
    skillsTaught: unit.skillsTaught ?? [],
    questionTemplateId: battleUnitTemplateId(unit.id),
    questionVersionId: battleUnitQuestionVersionId(unit.id, questionIndex),
    version: 1,
    questionType: question.type,
    difficulty,
    difficultyScore,
    estimatedSeconds,
    prompt: { stem: question.q },
    options,
    correctOptionIds,
    explanation: question.explain ?? '',
    calibrationKey: `${difficulty}:${difficultyScore.toFixed(1)}`,
  };
}

/** Flatten active quiz units into battle pool items. */
export function flattenQuizUnitsToPool(
  units: Unit[],
  secondsPerQuestion?: number,
): UnitBattlePoolItem[] {
  const out: UnitBattlePoolItem[] = [];
  for (const unit of units) {
    if (unit.lessonType !== 'quiz' || !unit.isActive) continue;
    const questions = extractQuizQuestions(unit.content ?? {});
    questions.forEach((q, i) => {
      const snap = mapQuizQuestionToSnapshot(unit, q, i, secondsPerQuestion);
      if (snap) out.push(snap);
    });
  }
  return out;
}

export function topicMatchesSkills(
  skillsTaught: string[],
  topicRaw?: string | null,
): boolean {
  if (!topicRaw?.trim()) return true;
  const raw = topicRaw.trim().toLowerCase();
  const needle = raw.replace(/\s+/g, '-');
  return skillsTaught.some((skill) => {
    const s = skill.toLowerCase();
    const local = s.includes(':') ? s.split(':').slice(1).join(':') : s;
    return (
      s === needle ||
      s === raw ||
      local === needle ||
      local === raw ||
      s.includes(needle) ||
      local.includes(needle) ||
      needle.includes(local) ||
      raw.includes(local.replace(/-/g, ' '))
    );
  });
}

export function skillIdMatchesTaught(
  skillsTaught: string[],
  skillId?: string | null,
): boolean {
  if (!skillId?.trim()) return true;
  const needle = skillId.trim().toLowerCase();
  return skillsTaught.some((s) => s.toLowerCase() === needle);
}
