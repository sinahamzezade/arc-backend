export const SystemFlagKey = {
  OTP_VERIFICATION_ENABLED: 'otp_verification_enabled',
  ROADMAP_ENGINE_MODE: 'roadmap_engine_mode',
  /** Kill-switch: AI propose+validate units order when engine mode=llm. */
  ROADMAP_AI_ORCHESTRATOR_ENABLED: 'roadmap_ai_orchestrator_enabled',
  INTAKE_CHAT_ENABLED: 'intake_chat_enabled',
  INTAKE_DEFAULT_MODE: 'intake_default_mode',
  QUESTIONNAIRE_AI_ENABLED: 'questionnaire_ai_enabled',
  ARLO_AI_ENABLED: 'arlo_ai_enabled',
  LESSON_BODY_AI_ENABLED: 'lesson_body_ai_enabled',
  SSO_ENABLED: 'sso_enabled',
  AVATAR_STUDIO_ENABLED: 'avatar_studio_enabled',
  VIDEO_CALL_ENABLED: 'video_call_enabled',
  VOICE_CALL_ENABLED: 'voice_call_enabled',
  /** Preferred provider for defaults; each model still routes to its owning provider. */
  LLM_PROVIDER: 'llm_provider',
  LLM_INTAKE_MODEL: 'llm_intake_model',
  LLM_ROADMAP_MODEL: 'llm_roadmap_model',
  LLM_ARLO_MODEL: 'llm_arlo_model',
  LLM_BATTLE_MODEL: 'llm_battle_model',
  LLM_LESSON_BODY_MODEL: 'llm_lesson_body_model',
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
  SystemFlagKey.VIDEO_CALL_ENABLED,
  SystemFlagKey.VOICE_CALL_ENABLED,
] as const;

/** Flags admins can override per user (resolve = user → system). */
export const USER_OVERRIDABLE_FLAG_KEYS = [
  SystemFlagKey.OTP_VERIFICATION_ENABLED,
  SystemFlagKey.ROADMAP_ENGINE_MODE,
  SystemFlagKey.ROADMAP_AI_ORCHESTRATOR_ENABLED,
  SystemFlagKey.INTAKE_CHAT_ENABLED,
  SystemFlagKey.INTAKE_DEFAULT_MODE,
  SystemFlagKey.ARLO_AI_ENABLED,
  SystemFlagKey.LESSON_BODY_AI_ENABLED,
  SystemFlagKey.AVATAR_STUDIO_ENABLED,
  SystemFlagKey.VIDEO_CALL_ENABLED,
  SystemFlagKey.VOICE_CALL_ENABLED,
] as const;

export const ROADMAP_ENGINE_MODES = ['llm', 'python', 'legacy'] as const;
export type RoadmapEngineMode = (typeof ROADMAP_ENGINE_MODES)[number];

export const INTAKE_MODES = ['form', 'chat'] as const;
export type IntakeModeFlag = (typeof INTAKE_MODES)[number];

/** Catalog lives in llm.providers.ts — single place to add providers/models. */
export {
  DEFAULT_LLM_MODEL,
  DEFAULT_LLM_PROVIDER,
  LLM_MODEL_OPTIONS,
  LLM_PROVIDER_IDS,
  LLM_PROVIDERS,
  type LlmProviderId,
} from '../common/llm/llm.providers';
