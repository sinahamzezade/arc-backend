export type QuestionnaireOptionDto = {
  value: string;
  label: string;
  icon?: string;
  iconClassName?: string;
  /** Safe display metadata only — scoring weights never exposed to clients. */
  profileHint?: string;
};

/** Adaptive branch rule — Question Engine only (not skill graph). */
export type StepVisibleWhen = {
  field: string;
  op: 'eq' | 'neq' | 'includes' | 'excludes';
  value: string | string[];
};

export type QuestionnaireUiKind =
  | 'options'
  | 'schedule'
  | 'track-select'
  | 'skill-evidence'
  | 'capacity'
  | 'outcome'
  | 'context'
  | 'confidence-barriers';

export type QuestionnaireStepDto = {
  id: string;
  stepNumber: number;
  title: string;
  subtitle: string;
  selection: 'single' | 'multi';
  allowOther?: boolean;
  uiKind: QuestionnaireUiKind;
  reviewLabel: string;
  reviewIcon: string;
  options: QuestionnaireOptionDto[];
  scheduleDays?: string[];
  scheduleTimes?: QuestionnaireOptionDto[];
  /** Exposure levels for skill-evidence uiKind */
  exposureOptions?: QuestionnaireOptionDto[];
  /** Session length choices for capacity uiKind */
  sessionOptions?: QuestionnaireOptionDto[];
  /** Secondary options for compound screens (outcome deadline, barriers, etc.) */
  secondaryOptions?: QuestionnaireOptionDto[];
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
