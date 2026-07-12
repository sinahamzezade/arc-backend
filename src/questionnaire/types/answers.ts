export type QuestionnaireAnswers = {
  goal: string[];
  motivation: string[];
  motivationOther?: string;
  currentJob: string;
  currentJobOther?: string;
  skills: string[];
  skillsOther?: string;
  studyHours: string;
  schedule: {
    days: string[];
    times: string[];
  };
  deadline: string;
  learningStyle: string[];
  learningStyleOther?: string;
  confidence: string;
  quitReasons: string[];
  quitReasonsOther?: string;
};

export const emptyQuestionnaireAnswers = (): QuestionnaireAnswers => ({
  goal: [],
  motivation: [],
  currentJob: '',
  skills: [],
  studyHours: '',
  schedule: { days: [], times: [] },
  deadline: '',
  learningStyle: [],
  confidence: '',
  quitReasons: [],
});
