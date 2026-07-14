import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  DEFAULT_LLM_MODEL,
  SystemFlagKey,
} from '../../system-flags/system-flag.keys';
import { SystemFlagsService } from '../../system-flags/system-flags.service';

export type LlmPurpose =
  | 'intake'
  | 'enrich'
  | 'questionnaire_copy'
  | 'arlo'
  | 'battle';

/**
 * Provider-agnostic OpenAI-compatible client.
 * Groq: LLM_BASE_URL=https://api.groq.com/openai/v1
 * OpenRouter: LLM_BASE_URL=https://openrouter.ai/api/v1
 *
 * Model picks for roadmap / arlo / battle live in admin Feature flags.
 */
@Injectable()
export class LlmService {
  constructor(
    private readonly config: ConfigService,
    private readonly systemFlags: SystemFlagsService,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.resolveApiKey());
  }

  isOpenRouter(): boolean {
    return Boolean(this.resolveBaseUrl()?.includes('openrouter.ai'));
  }

  resolveApiKey(): string | null {
    const key =
      this.config.get<string>('LLM_API_KEY')?.trim() ||
      this.config.get<string>('OPENAI_API_KEY')?.trim() ||
      '';
    return key || null;
  }

  resolveBaseUrl(): string | undefined {
    const url = this.config.get<string>('LLM_BASE_URL')?.trim();
    return url || undefined;
  }

  async getModel(purpose: LlmPurpose): Promise<string> {
    switch (purpose) {
      case 'intake':
        return (
          this.config.get<string>('LLM_INTAKE_MODEL')?.trim() ||
          this.config.get<string>('OPENAI_ROADMAP_MODEL')?.trim() ||
          DEFAULT_LLM_MODEL
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
          'gpt-4o-mini'
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
      'meta-llama/llama-3.2-3b-instruct:free',
    ];
    const list = (raw ? raw.split(',') : defaults)
      .map((s) => s.trim())
      .filter((s) => s && s !== primary);
    // OpenRouter: models array max 3 items
    // https://openrouter.ai/docs/guides/routing/model-fallbacks
    return [...new Set(list)].slice(0, 3);
  }

  createClient(): OpenAI | null {
    const apiKey = this.resolveApiKey();
    if (!apiKey) return null;
    const baseURL = this.resolveBaseUrl();
    const defaultHeaders = this.openRouterHeaders(baseURL);
    return new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      ...(defaultHeaders ? { defaultHeaders } : {}),
    });
  }

  /**
   * OpenRouter attribution headers (optional but recommended).
   * @see https://openrouter.ai/docs/quickstart
   */
  private openRouterHeaders(
    baseURL: string | undefined,
  ): Record<string, string> | undefined {
    if (!baseURL?.includes('openrouter.ai')) return undefined;
    const referer =
      this.config.get<string>('LLM_HTTP_REFERER')?.trim() ||
      this.config.get<string>('PUBLIC_APP_URL')?.trim() ||
      'http://localhost:3000';
    const title = this.config.get<string>('LLM_APP_TITLE')?.trim() || 'Arc';
    return {
      'HTTP-Referer': referer,
      'X-OpenRouter-Title': title,
    };
  }
}
