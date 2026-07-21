import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  DEFAULT_LLM_MODEL,
  DEFAULT_LLM_PROVIDER,
  SystemFlagKey,
} from '../../system-flags/system-flag.keys';
import { SystemFlagsService } from '../../system-flags/system-flags.service';
import {
  findProviderForModel,
  getProvider,
  isLlmProviderId,
  LLM_PROVIDERS,
  type LlmProviderDef,
  type LlmProviderId,
} from './llm.providers';
import { LlmUsageService } from './llm-usage.service';
import type { LlmPurpose } from './llm.types';

export type { LlmPurpose } from './llm.types';
export { LLM_PURPOSE_LABELS } from './llm.types';

export type LlmChatCompletionRequest =
  OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & {
    /** OpenRouter failover list */
    models?: string[];
  };

export type OpenRouterModelOption = {
  id: string;
  label: string;
};

type OpenRouterModelsApiRow = {
  id?: string;
  name?: string;
  pricing?: { prompt?: string; completion?: string };
};

/**
 * OpenAI-compatible multi-provider client.
 * Model id → provider from catalog (`llm.providers.ts`).
 * Optional LLM_BASE_URL / LLM_API_KEY = legacy single-endpoint override when model unknown.
 *
 * @see https://inference-docs.cerebras.ai/resources/openai
 * @see https://openrouter.ai/docs/guides/overview/models
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private openRouterFreeCache:
    | { at: number; models: OpenRouterModelOption[] }
    | null = null;
  private static readonly OPENROUTER_FREE_TTL_MS = 10 * 60 * 1000;

  constructor(
    private readonly config: ConfigService,
    private readonly systemFlags: SystemFlagsService,
    private readonly usage: LlmUsageService,
  ) {}

  isConfigured(): boolean {
    for (const id of Object.keys(LLM_PROVIDERS) as LlmProviderId[]) {
      if (this.resolveApiKeyForProvider(id)) return true;
    }
    return Boolean(this.resolveLegacyApiKey());
  }

  isOpenRouter(model?: string): boolean {
    if (model) {
      return findProviderForModel(model)?.id === 'openrouter';
    }
    return Boolean(this.resolveLegacyBaseUrl()?.includes('openrouter.ai'));
  }

  /**
   * Live free text models from OpenRouter Models API (`min_price=0&max_price=0`).
   * Falls back to static catalog on error / missing key.
   * @see https://openrouter.ai/docs/api/api-reference/models/get-models
   */
  async listOpenRouterFreeModels(): Promise<OpenRouterModelOption[]> {
    const cached = this.openRouterFreeCache;
    if (
      cached &&
      Date.now() - cached.at < LlmService.OPENROUTER_FREE_TTL_MS
    ) {
      return cached.models;
    }

    const apiKey = this.resolveApiKeyForProvider('openrouter');
    if (!apiKey) {
      return this.openRouterCatalogFallback();
    }

    try {
      const url =
        'https://openrouter.ai/api/v1/models?output_modalities=text&min_price=0&max_price=0';
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          ...(this.openRouterHeaders(
            'openrouter',
            getProvider('openrouter').baseURL,
          ) ?? {}),
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        throw new Error(`OpenRouter models HTTP ${res.status}`);
      }
      const payload = (await res.json()) as { data?: OpenRouterModelsApiRow[] };
      const rows = payload.data ?? [];
      const models: OpenRouterModelOption[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        const id = String(row.id ?? '').trim();
        if (!id || seen.has(id)) continue;
        if (!this.isOpenRouterChatFreeModel(id, row)) continue;
        seen.add(id);
        models.push({
          id,
          label: String(row.name ?? id).trim() || id,
        });
      }
      models.sort((a, b) => a.label.localeCompare(b.label));
      if (models.length === 0) {
        return this.openRouterCatalogFallback();
      }
      this.openRouterFreeCache = { at: Date.now(), models };
      return models;
    } catch (err) {
      this.logger.warn(
        `OpenRouter free models fetch failed: ${err instanceof Error ? err.message : err}`,
      );
      return this.openRouterCatalogFallback();
    }
  }

  /** @deprecated Prefer resolveApiKeyForProvider — kept for soft-fail checks */
  resolveApiKey(): string | null {
    return (
      this.resolveApiKeyForProvider(DEFAULT_LLM_PROVIDER) ||
      this.resolveLegacyApiKey()
    );
  }

  resolveBaseUrl(): string | undefined {
    return (
      getProvider(DEFAULT_LLM_PROVIDER).baseURL || this.resolveLegacyBaseUrl()
    );
  }

  async getPreferredProvider(): Promise<LlmProviderId> {
    const raw = await this.systemFlags.getString(
      SystemFlagKey.LLM_PROVIDER,
      DEFAULT_LLM_PROVIDER,
    );
    return isLlmProviderId(raw) ? raw : DEFAULT_LLM_PROVIDER;
  }

  async getModel(purpose: LlmPurpose): Promise<string> {
    switch (purpose) {
      case 'intake':
        return this.systemFlags.getString(
          SystemFlagKey.LLM_INTAKE_MODEL,
          DEFAULT_LLM_MODEL,
        );
      case 'enrich':
        return this.systemFlags.getString(
          SystemFlagKey.LLM_ROADMAP_MODEL,
          DEFAULT_LLM_MODEL,
        );
      case 'questionnaire_copy':
        return (
          this.config.get<string>('OPENAI_QUESTIONNAIRE_MODEL')?.trim() ||
          (await this.systemFlags.getString(
            SystemFlagKey.LLM_ROADMAP_MODEL,
            '',
          )) ||
          this.config.get<string>('OPENAI_ROADMAP_MODEL')?.trim() ||
          DEFAULT_LLM_MODEL
        );
      case 'arlo':
        return this.systemFlags.getString(
          SystemFlagKey.LLM_ARLO_MODEL,
          DEFAULT_LLM_MODEL,
        );
      case 'battle':
        return this.systemFlags.getString(
          SystemFlagKey.LLM_BATTLE_MODEL,
          DEFAULT_LLM_MODEL,
        );
      case 'lesson_body':
        return this.systemFlags.getString(
          SystemFlagKey.LLM_LESSON_BODY_MODEL,
          DEFAULT_LLM_MODEL,
        );
      case 'roadmap_completion_coach':
        return this.systemFlags.getString(
          SystemFlagKey.LLM_ARLO_MODEL,
          DEFAULT_LLM_MODEL,
        );
      default:
        return DEFAULT_LLM_MODEL;
    }
  }

  /**
   * OpenRouter `models` failover list (tried after primary on 429/downtime).
   * @see https://openrouter.ai/docs/guides/routing/model-fallbacks
   */
  getIntakeFallbackModels(primary: string): string[] {
    const raw = this.config.get<string>('LLM_INTAKE_FALLBACK_MODELS')?.trim();
    const defaults = [
      'openai/gpt-oss-20b:free',
      'google/gemma-4-31b-it:free',
      'google/gemma-4-26b-a4b-it:free',
    ];
    const list = (raw ? raw.split(',') : defaults)
      .map((s) => s.trim())
      .filter((s) => s && s !== primary);
    return [...new Set(list)].slice(0, 3);
  }

  createClient(model?: string): OpenAI | null {
    const provider = this.resolveProviderDef(model);
    const fromCatalog = findProviderForModel(model ?? '');
    const apiKey = fromCatalog
      ? this.resolveApiKeyForProvider(fromCatalog.id)
      : this.resolveLegacyApiKey() ||
        this.resolveApiKeyForProvider(provider.id);
    if (!apiKey) return null;
    const baseURL = provider.baseURL;
    const defaultHeaders = this.openRouterHeaders(provider.id, baseURL);
    return new OpenAI({
      apiKey,
      baseURL,
      ...(defaultHeaders ? { defaultHeaders } : {}),
    });
  }

  /**
   * Preferred chat entry — records token usage when provider returns it.
   * Routes to the provider that owns `request.model`.
   */
  async chatCompletion(input: {
    purpose: LlmPurpose;
    userId?: string | null;
    request: LlmChatCompletionRequest;
  }): Promise<OpenAI.Chat.ChatCompletion> {
    const client = this.createClient(input.request.model);
    if (!client) {
      const provider = this.resolveProviderDef(input.request.model);
      throw new Error(
        `LLM not configured for provider "${provider.id}" (model: ${input.request.model}). Set one of: ${provider.apiKeyEnv.join(', ')}`,
      );
    }
    const completion = await client.chat.completions.create(input.request);
    await this.usage.recordFromCompletion({
      userId: input.userId,
      purpose: input.purpose,
      requestedModel: input.request.model,
      completion,
    });
    return completion;
  }

  private openRouterCatalogFallback(): OpenRouterModelOption[] {
    const provider = getProvider('openrouter');
    return provider.models.map((m) => ({
      id: m.id,
      label: m.label ?? m.id,
    }));
  }

  private isOpenRouterChatFreeModel(
    id: string,
    row: OpenRouterModelsApiRow,
  ): boolean {
    const lower = id.toLowerCase();
    // Skip non-chat free endpoints (music / guardrails)
    if (lower.includes('lyria') || lower.includes('content-safety')) {
      return false;
    }
    const pricing = row.pricing ?? {};
    const prompt = Number(pricing.prompt ?? 0);
    const completion = Number(pricing.completion ?? 0);
    return (prompt === 0 && completion === 0) || lower.endsWith(':free');
  }

  private resolveProviderDef(model?: string): LlmProviderDef {
    if (model) {
      const byModel = findProviderForModel(model);
      if (byModel) return byModel;
    }
    const legacyUrl = this.resolveLegacyBaseUrl();
    if (legacyUrl) {
      // Unknown model + explicit BASE_URL → treat as ad-hoc OpenAI-compat endpoint
      return {
        id: 'openai',
        label: 'Custom (LLM_BASE_URL)',
        baseURL: legacyUrl,
        apiKeyEnv: ['LLM_API_KEY', 'OPENAI_API_KEY', 'CEREBRAS_API_KEY'],
        defaultModel: model || DEFAULT_LLM_MODEL,
        models: model ? [{ id: model }] : [],
      };
    }
    return getProvider(DEFAULT_LLM_PROVIDER);
  }

  private resolveApiKeyForProvider(providerId: LlmProviderId): string | null {
    const provider = getProvider(providerId);
    for (const envKey of provider.apiKeyEnv) {
      const key = this.config.get<string>(envKey)?.trim();
      if (key) return key;
    }
    return this.resolveLegacyApiKey();
  }

  private resolveLegacyApiKey(): string | null {
    const key =
      this.config.get<string>('LLM_API_KEY')?.trim() ||
      this.config.get<string>('OPENAI_API_KEY')?.trim() ||
      this.config.get<string>('CEREBRAS_API_KEY')?.trim() ||
      '';
    return key || null;
  }

  private resolveLegacyBaseUrl(): string | undefined {
    const url = this.config.get<string>('LLM_BASE_URL')?.trim();
    return url || undefined;
  }

  private openRouterHeaders(
    providerId: LlmProviderId,
    baseURL: string,
  ): Record<string, string> | undefined {
    if (providerId !== 'openrouter' && !baseURL.includes('openrouter.ai')) {
      return undefined;
    }
    const referer =
      this.config.get<string>('LLM_HTTP_REFERER')?.trim() ||
      this.config.get<string>('PUBLIC_APP_URL')?.trim() ||
      'http://localhost:3000';
    const title = this.config.get<string>('LLM_APP_TITLE')?.trim() || 'Arlo';
    return {
      'HTTP-Referer': referer,
      'X-OpenRouter-Title': title,
    };
  }
}
