import type {
  QuestionVersion,
  QuestionVersionAnswer,
} from './entities/question-version.entity';
import {
  decryptAnswerPayload,
  encryptAnswerPayload,
} from './content-security.util';

/**
 * Normalize stored answer jsonb → grading fields.
 * Supports legacy plaintext and encrypted `_secure` payloads.
 */
export function resolveQuestionAnswer(
  version: Pick<QuestionVersion, 'answer' | 'explanation'>,
): QuestionVersionAnswer {
  const raw = (version.answer ?? {}) as QuestionVersionAnswer & {
    _secure?: string;
  };
  if (raw._secure) {
    const decrypted = decryptAnswerPayload(raw._secure);
    return {
      options: raw.options ?? [],
      correctOptionIds:
        (decrypted?.correctOptionIds as string[] | undefined) ??
        raw.correctOptionIds ??
        [],
      correctText:
        (decrypted?.correctText as string | undefined) ?? raw.correctText,
      explanation:
        (decrypted?.explanation as string | undefined) ??
        raw.explanation ??
        version.explanation,
    };
  }
  return {
    options: raw.options ?? [],
    correctOptionIds: raw.correctOptionIds ?? [],
    correctText: raw.correctText,
    explanation: raw.explanation ?? version.explanation,
  };
}

/** Store options in clear; encrypt grading keys. */
export function sealQuestionAnswer(
  answer: QuestionVersionAnswer,
): Record<string, unknown> {
  const secure = encryptAnswerPayload({
    correctOptionIds: answer.correctOptionIds ?? [],
    correctText: answer.correctText,
    explanation: answer.explanation,
  });
  return {
    options: answer.options ?? [],
    _secure: secure,
  };
}
