export type LlmPurpose =
  | 'intake'
  | 'enrich'
  | 'questionnaire_copy'
  | 'arlo'
  | 'battle'
  | 'lesson_body';

export const LLM_PURPOSE_LABELS: Record<LlmPurpose, string> = {
  intake: 'Intake chat',
  enrich: 'Roadmap planning',
  questionnaire_copy: 'Questionnaire copy',
  arlo: 'Arlo coach',
  battle: 'Battle questions',
  lesson_body: 'Lesson personalization',
};
