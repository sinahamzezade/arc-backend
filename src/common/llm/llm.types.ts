export type LlmPurpose =
  | 'intake'
  | 'enrich'
  | 'questionnaire_copy'
  | 'arlo'
  | 'battle'
  | 'lesson_body'
  | 'roadmap_completion_coach';

export const LLM_PURPOSE_LABELS: Record<LlmPurpose, string> = {
  intake: 'Intake chat',
  enrich: 'Roadmap planning',
  questionnaire_copy: 'Questionnaire copy',
  arlo: 'Arlo coach',
  battle: 'Battle questions',
  lesson_body: 'Lesson personalization',
  roadmap_completion_coach: 'Roadmap completion coach',
};
