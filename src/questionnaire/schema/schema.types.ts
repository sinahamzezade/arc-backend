export type QuestionnaireOptionDto = {
  value: string;
  label: string;
  icon?: string;
  iconClassName?: string;
};

/** Adaptive branch rule — Question Engine only (not skill graph). */
export type StepVisibleWhen = {
  field: string;
  op: 'eq' | 'neq' | 'includes' | 'excludes';
  value: string | string[];
};

export type QuestionnaireStepDto = {
  id: string;
  stepNumber: number;
  title: string;
  subtitle: string;
  selection: 'single' | 'multi';
  allowOther?: boolean;
  uiKind: 'options' | 'schedule';
  reviewLabel: string;
  reviewIcon: string;
  options: QuestionnaireOptionDto[];
  scheduleDays?: string[];
  scheduleTimes?: QuestionnaireOptionDto[];
  /** Omit / undefined = always visible. Array = AND. */
  visibleWhen?: StepVisibleWhen | StepVisibleWhen[];
};

export type QuestionnaireSchemaDto = {
  schemaVersion: number;
  totalSteps: number;
  steps: QuestionnaireStepDto[];
};

/** Loose answer shape for branch evaluation (draft or complete). */
export type QuestionnaireAnswersLike = Record<string, unknown>;
