/**
 * LLM provider + model catalog.
 *
 * Add a provider: append to LLM_PROVIDERS.
 * Add a model: append to that provider's `models` array.
 * Runtime routes each completion by model id → provider (base URL + API key).
 *
 * All entries use OpenAI-compatible chat/completions.
 * @see https://inference-docs.cerebras.ai/resources/openai
 */

export type LlmProviderId =
  'groq' | 'cerebras' | 'openrouter' | 'openai' | 'gemini';

export type LlmModelDef = {
  /** Exact model id sent to the provider API */
  id: string;
  /** Admin select label (defaults to id) */
  label?: string;
};

export type LlmProviderDef = {
  id: LlmProviderId;
  label: string;
  /** OpenAI-compatible base URL */
  baseURL: string;
  /** Env vars checked in order for this provider's API key */
  apiKeyEnv: readonly string[];
  defaultModel: string;
  models: readonly LlmModelDef[];
};

export const LLM_PROVIDERS: Record<LlmProviderId, LlmProviderDef> = {
  groq: {
    id: 'groq',
    label: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    apiKeyEnv: ['GROQ_API_KEY', 'LLM_API_KEY', 'OPENAI_API_KEY'],
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      { id: 'llama-3.3-70b-versatile' },
      { id: 'llama-3.1-8b-instant' },
      { id: 'llama-3.1-70b-versatile' },
      { id: 'meta-llama/llama-4-scout-17b-16e-instruct' },
      { id: 'gemma2-9b-it' },
      { id: 'qwen/qwen3-32b' },
      { id: 'deepseek-r1-distill-llama-70b' },
      { id: 'mixtral-8x7b-32768' },
    ],
  },
  cerebras: {
    id: 'cerebras',
    label: 'Cerebras',
    baseURL: 'https://api.cerebras.ai/v1',
    apiKeyEnv: ['CEREBRAS_API_KEY', 'LLM_API_KEY'],
    defaultModel: 'gemma-4-31b',
    models: [
      { id: 'gemma-4-31b', label: 'gemma-4-31b (Cerebras)' },
      { id: 'gpt-oss-120b', label: 'gpt-oss-120b (Cerebras)' },
      { id: 'zai-glm-4.7', label: 'zai-glm-4.7 (Cerebras)' },
    ],
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnv: ['OPENROUTER_API_KEY', 'LLM_API_KEY', 'OPENAI_API_KEY'],
    defaultModel: 'openai/gpt-4o-mini',
    models: [
      { id: 'openai/gpt-4o-mini' },
      { id: 'openai/gpt-4o' },
      { id: 'google/gemma-4-31b-it:free' },
      { id: 'meta-llama/llama-3.2-3b-instruct:free' },
      { id: 'openai/gpt-oss-20b:free' },
    ],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    apiKeyEnv: ['OPENAI_API_KEY', 'LLM_API_KEY'],
    defaultModel: 'gpt-4o-mini',
    models: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }],
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKeyEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'LLM_API_KEY'],
    defaultModel: 'gemini-2.5-flash',
    models: [
      { id: 'gemini-2.5-flash' },
      { id: 'gemini-2.5-pro' },
      { id: 'gemini-2.0-flash' },
    ],
  },
};

export const LLM_PROVIDER_IDS = Object.keys(LLM_PROVIDERS) as LlmProviderId[];

export const DEFAULT_LLM_PROVIDER: LlmProviderId = 'cerebras';

/** Flat admin select list: unique model ids across all providers. */
export const LLM_MODEL_OPTIONS: string[] = (() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const provider of Object.values(LLM_PROVIDERS)) {
    for (const model of provider.models) {
      if (seen.has(model.id)) continue;
      seen.add(model.id);
      out.push(model.id);
    }
  }
  return out;
})();

export const DEFAULT_LLM_MODEL =
  LLM_PROVIDERS[DEFAULT_LLM_PROVIDER].defaultModel;

export function isLlmProviderId(value: string): value is LlmProviderId {
  return value in LLM_PROVIDERS;
}

export function getProvider(id: LlmProviderId): LlmProviderDef {
  return LLM_PROVIDERS[id];
}

/** Find which provider owns a model id (first match wins). */
export function findProviderForModel(modelId: string): LlmProviderDef | null {
  const needle = modelId.trim().toLowerCase();
  for (const provider of Object.values(LLM_PROVIDERS)) {
    if (provider.models.some((m) => m.id.toLowerCase() === needle)) {
      return provider;
    }
  }
  return null;
}

export function modelLabel(modelId: string): string {
  for (const provider of Object.values(LLM_PROVIDERS)) {
    const hit = provider.models.find(
      (m) => m.id.toLowerCase() === modelId.trim().toLowerCase(),
    );
    if (hit) {
      return hit.label ?? `${hit.id} (${provider.label})`;
    }
  }
  return modelId;
}

/** Models for one provider (admin filter). */
export function modelsForProvider(providerId: LlmProviderId): string[] {
  return LLM_PROVIDERS[providerId].models.map((m) => m.id);
}
