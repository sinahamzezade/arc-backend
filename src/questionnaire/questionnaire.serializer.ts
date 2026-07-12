import { QuestionnaireResponse } from './entities/questionnaire-response.entity';
import { QUESTIONNAIRE_SCHEMA_VERSION } from './constants/schema-version';
import type { QuestionnaireAnswers } from './types/answers';

export function toQuestionnaireDto(row: QuestionnaireResponse | null): {
  id: string | null;
  status: 'not_started' | 'draft' | 'submitted';
  schemaVersion: number;
  answers: QuestionnaireAnswers | null;
  goalId: string | null;
  submittedAt: string | null;
  updatedAt: string | null;
} {
  if (!row) {
    return {
      id: null,
      status: 'not_started',
      schemaVersion: QUESTIONNAIRE_SCHEMA_VERSION,
      answers: null,
      goalId: null,
      submittedAt: null,
      updatedAt: null,
    };
  }

  return {
    id: row.id,
    status: row.status,
    schemaVersion: row.schemaVersion,
    answers: row.answers,
    goalId: row.goalId,
    submittedAt: row.submittedAt?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? null,
  };
}
