export const SystemFlagKey = {
  OTP_VERIFICATION_ENABLED: 'otp_verification_enabled',
  ROADMAP_ENGINE_MODE: 'roadmap_engine_mode',
  INTAKE_CHAT_ENABLED: 'intake_chat_enabled',
  INTAKE_DEFAULT_MODE: 'intake_default_mode',
  QUESTIONNAIRE_AI_ENABLED: 'questionnaire_ai_enabled',
  ARLO_AI_ENABLED: 'arlo_ai_enabled',
  SSO_ENABLED: 'sso_enabled',
  AVATAR_STUDIO_ENABLED: 'avatar_studio_enabled',
  LLM_ROADMAP_MODEL: 'llm_roadmap_model',
  LLM_ARLO_MODEL: 'llm_arlo_model',
  LLM_BATTLE_MODEL: 'llm_battle_model',
} as const;

export type SystemFlagKeyName =
  (typeof SystemFlagKey)[keyof typeof SystemFlagKey];

/** Keys exposed on public GET /system/flags for the app. */
export const PUBLIC_SYSTEM_FLAG_KEYS = [
  SystemFlagKey.OTP_VERIFICATION_ENABLED,
  SystemFlagKey.INTAKE_CHAT_ENABLED,
  SystemFlagKey.INTAKE_DEFAULT_MODE,
  SystemFlagKey.ARLO_AI_ENABLED,
  SystemFlagKey.SSO_ENABLED,
  SystemFlagKey.AVATAR_STUDIO_ENABLED,
] as const;

/** Flags admins can override per user (resolve = user → system). */
export const USER_OVERRIDABLE_FLAG_KEYS = [
  SystemFlagKey.OTP_VERIFICATION_ENABLED,
  SystemFlagKey.ROADMAP_ENGINE_MODE,
  SystemFlagKey.INTAKE_CHAT_ENABLED,
  SystemFlagKey.INTAKE_DEFAULT_MODE,
  SystemFlagKey.ARLO_AI_ENABLED,
  SystemFlagKey.AVATAR_STUDIO_ENABLED,
] as const;

export const ROADMAP_ENGINE_MODES = ['llm', 'python', 'legacy'] as const;
export type RoadmapEngineMode = (typeof ROADMAP_ENGINE_MODES)[number];

export const INTAKE_MODES = ['form', 'chat'] as const;
export type IntakeModeFlag = (typeof INTAKE_MODES)[number];

/** Admin select options for LLM_*_MODEL flags (Groq + common OpenRouter ids). */
export const LLM_MODEL_OPTIONS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'llama-3.1-70b-versatile',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'gemma2-9b-it',
  'qwen/qwen3-32b',
  'deepseek-r1-distill-llama-70b',
  'mixtral-8x7b-32768',
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'gpt-4o-mini',
] as const;

export type LlmModelOption = (typeof LLM_MODEL_OPTIONS)[number];

export const DEFAULT_LLM_MODEL = 'llama-3.3-70b-versatile';
