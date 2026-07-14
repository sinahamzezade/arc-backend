import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  SystemFlag,
  type SystemFlagValueType,
} from './entities/system-flag.entity';
import { UserFeatureFlag } from './entities/user-feature-flag.entity';
import {
  DEFAULT_LLM_MODEL,
  DEFAULT_LLM_PROVIDER,
  INTAKE_MODES,
  LLM_MODEL_OPTIONS,
  LLM_PROVIDER_IDS,
  PUBLIC_SYSTEM_FLAG_KEYS,
  ROADMAP_ENGINE_MODES,
  SystemFlagKey,
  USER_OVERRIDABLE_FLAG_KEYS,
  type SystemFlagKeyName,
} from './system-flag.keys';
import { modelLabel } from '../common/llm/llm.providers';

type FlagDef = {
  key: SystemFlagKeyName;
  valueType: SystemFlagValueType;
  label: string;
  description: string;
  defaultValue: string;
};

export type UserFlagAdminRow = {
  key: SystemFlagKeyName;
  label: string;
  description: string;
  valueType: SystemFlagValueType;
  systemValue: string;
  overrideValue: string | null;
  effectiveValue: string;
  options: string[] | null;
};

const CACHE_TTL_MS = 10_000;
const INHERIT = '__inherit__';

@Injectable()
export class SystemFlagsService implements OnModuleInit {
  private readonly logger = new Logger(SystemFlagsService.name);
  private cache = new Map<string, { value: string; expiresAt: number }>();

  constructor(
    @InjectRepository(SystemFlag)
    private readonly flagsRepo: Repository<SystemFlag>,
    @InjectRepository(UserFeatureFlag)
    private readonly userFlagsRepo: Repository<UserFeatureFlag>,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.ensureSeeded();
  }

  private defs(): FlagDef[] {
    return [
      {
        key: SystemFlagKey.OTP_VERIFICATION_ENABLED,
        valueType: 'boolean',
        label: 'OTP email verification',
        description:
          'Require email OTP verification for new signups. When off, new email accounts are auto-verified.',
        defaultValue: 'true',
      },
      {
        key: SystemFlagKey.ROADMAP_ENGINE_MODE,
        valueType: 'string',
        label: 'Roadmap engine mode',
        description:
          'Planner path: llm (AI chatbot planner), python (Roadmap-engine), or legacy Nest assembler.',
        defaultValue: this.envOr(
          'ROADMAP_ENGINE_MODE',
          'llm',
          ROADMAP_ENGINE_MODES as unknown as string[],
        ),
      },
      {
        key: SystemFlagKey.INTAKE_CHAT_ENABLED,
        valueType: 'boolean',
        label: 'Intake AI chatbot',
        description:
          'Allow conversational intake chat. When off, questionnaire is form-only.',
        defaultValue: this.envBoolDefault('INTAKE_CHAT_ENABLED', true),
      },
      {
        key: SystemFlagKey.INTAKE_DEFAULT_MODE,
        valueType: 'string',
        label: 'Default intake mode',
        description:
          'Intake UI when chat is on: form or chat. Overrides any saved user preference.',
        defaultValue: this.envOr(
          'INTAKE_DEFAULT_MODE',
          'form',
          INTAKE_MODES as unknown as string[],
        ),
      },
      {
        key: SystemFlagKey.QUESTIONNAIRE_AI_ENABLED,
        valueType: 'boolean',
        label: 'Questionnaire AI copy',
        description: 'Generate questionnaire question copy via LLM.',
        defaultValue: this.envBoolDefault('QUESTIONNAIRE_AI_ENABLED', true),
      },
      {
        key: SystemFlagKey.ARLO_AI_ENABLED,
        valueType: 'boolean',
        label: 'Arlo lesson AI',
        description: 'Enable Arlo AI chat during lessons.',
        defaultValue: this.envBoolDefault('ARLO_AI_ENABLED', true),
      },
      {
        key: SystemFlagKey.LESSON_BODY_AI_ENABLED,
        valueType: 'boolean',
        label: 'Lesson body personalization',
        description:
          'After materialize, rewrite lesson teaching copy from intake answers (practice/quiz stay scaffold).',
        defaultValue: this.envBoolDefault('LESSON_BODY_AI_ENABLED', false),
      },
      {
        key: SystemFlagKey.SSO_ENABLED,
        valueType: 'boolean',
        label: 'Google / Apple SSO',
        description:
          'Show Sign in with Google and Apple on login and register screens.',
        defaultValue: this.envBoolDefault('SSO_ENABLED', true),
      },
      {
        key: SystemFlagKey.AVATAR_STUDIO_ENABLED,
        valueType: 'boolean',
        label: 'Avatar Studio',
        description:
          'Allow Avatar Studio (customize chibi look) from profile and identity.',
        defaultValue: this.envBoolDefault('AVATAR_STUDIO_ENABLED', true),
      },
      {
        key: SystemFlagKey.LLM_PROVIDER,
        valueType: 'string',
        label: 'LLM · Preferred provider',
        description:
          'Default catalog provider for seeds. Each selected model still routes to its own API (Groq / Cerebras / OpenRouter / …).',
        defaultValue: this.envOr('LLM_PROVIDER', DEFAULT_LLM_PROVIDER, [
          ...LLM_PROVIDER_IDS,
        ]),
      },
      {
        key: SystemFlagKey.LLM_INTAKE_MODEL,
        valueType: 'string',
        label: 'LLM · Intake chat',
        description:
          'Model for conversational intake / skill suggestions (purpose: intake).',
        defaultValue: DEFAULT_LLM_MODEL,
      },
      {
        key: SystemFlagKey.LLM_ROADMAP_MODEL,
        valueType: 'string',
        label: 'LLM · Roadmap planner',
        description:
          'Model for roadmap enrichment / LLM planner (purpose: enrich).',
        defaultValue: this.envModelOr(
          ['LLM_ROADMAP_MODEL', 'OPENAI_ROADMAP_MODEL'],
          DEFAULT_LLM_MODEL,
        ),
      },
      {
        key: SystemFlagKey.LLM_ARLO_MODEL,
        valueType: 'string',
        label: 'LLM · Arlo lesson coach',
        description: 'Model for Arlo in-lesson chat.',
        defaultValue: this.envModelOr(
          ['LLM_ARLO_MODEL', 'OPENAI_ARLO_MODEL', 'LLM_ROADMAP_MODEL'],
          DEFAULT_LLM_MODEL,
        ),
      },
      {
        key: SystemFlagKey.LLM_BATTLE_MODEL,
        valueType: 'string',
        label: 'LLM · Battle questions',
        description: 'Model for battle MCQ generation from lesson catalog.',
        defaultValue: this.envModelOr(
          ['LLM_BATTLE_MODEL', 'LLM_ROADMAP_MODEL'],
          DEFAULT_LLM_MODEL,
        ),
      },
      {
        key: SystemFlagKey.LLM_LESSON_BODY_MODEL,
        valueType: 'string',
        label: 'LLM · Lesson body personalizer',
        description:
          'Model for intake-based rewrite of lesson content pages (purpose: lesson_body).',
        defaultValue: this.envModelOr(
          ['LLM_LESSON_BODY_MODEL', 'LLM_ROADMAP_MODEL'],
          DEFAULT_LLM_MODEL,
        ),
      },
    ];
  }

  async ensureSeeded() {
    const defs = this.defs();
    for (const def of defs) {
      const existing = await this.flagsRepo.findOne({
        where: { key: def.key },
      });
      if (existing) continue;
      await this.flagsRepo.save(
        this.flagsRepo.create({
          key: def.key,
          value: def.defaultValue,
          valueType: def.valueType,
          label: def.label,
          description: def.description,
        }),
      );
      this.logger.log(`Seeded system flag ${def.key}=${def.defaultValue}`);
    }
  }

  async list(): Promise<SystemFlag[]> {
    await this.ensureSeeded();
    const rows = await this.flagsRepo.find({ order: { key: 'ASC' } });
    const order = this.defs().map((d) => d.key);
    return rows.sort(
      (a, b) =>
        order.indexOf(a.key as SystemFlagKeyName) -
        order.indexOf(b.key as SystemFlagKeyName),
    );
  }

  /** System-level raw value (cached). */
  async getSystemRaw(key: SystemFlagKeyName): Promise<string> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    await this.ensureSeeded();
    const row = await this.flagsRepo.findOne({ where: { key } });
    const def = this.defs().find((d) => d.key === key);
    const value = row?.value ?? def?.defaultValue ?? '';
    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  /**
   * Resolved raw value: user override → system default.
   * Pass userId when request is authenticated.
   */
  async getRaw(
    key: SystemFlagKeyName,
    userId?: string | null,
  ): Promise<string> {
    if (userId) {
      const over = await this.userFlagsRepo.findOne({
        where: { userId, key },
      });
      if (over) return over.value;
    }
    return this.getSystemRaw(key);
  }

  async getBool(
    key: SystemFlagKeyName,
    fallback = true,
    userId?: string | null,
  ): Promise<boolean> {
    const raw = (await this.getRaw(key, userId)).trim().toLowerCase();
    if (raw === 'true' || raw === '1' || raw === 'on') return true;
    if (raw === 'false' || raw === '0' || raw === 'off') return false;
    return fallback;
  }

  async getString(
    key: SystemFlagKeyName,
    fallback = '',
    userId?: string | null,
  ): Promise<string> {
    const raw = (await this.getRaw(key, userId)).trim();
    return raw || fallback;
  }

  async set(key: SystemFlagKeyName, value: string): Promise<SystemFlag> {
    await this.ensureSeeded();
    const row = await this.flagsRepo.findOne({ where: { key } });
    if (!row) {
      throw new Error(`Unknown system flag: ${key}`);
    }
    const normalized = this.normalizeValue(key, row.valueType, value);
    row.value = normalized;
    const saved = await this.flagsRepo.save(row);
    this.cache.delete(key);
    this.logger.log(`Updated system flag ${key}=${normalized}`);
    return saved;
  }

  async setMany(updates: Record<string, string>): Promise<void> {
    const known = new Set(this.defs().map((d) => d.key));
    for (const [key, value] of Object.entries(updates)) {
      if (!known.has(key as SystemFlagKeyName)) continue;
      await this.set(key as SystemFlagKeyName, value);
    }
  }

  async getPublicFlags(
    userId?: string | null,
  ): Promise<Record<string, string | boolean>> {
    const out: Record<string, string | boolean> = {};
    for (const key of PUBLIC_SYSTEM_FLAG_KEYS) {
      const def = this.defs().find((d) => d.key === key);
      if (!def) continue;
      if (def.valueType === 'boolean') {
        out[key] = await this.getBool(key, true, userId);
      } else {
        out[key] = await this.getString(key, '', userId);
      }
    }
    return out;
  }

  async listForUser(userId: string): Promise<UserFlagAdminRow[]> {
    await this.ensureSeeded();
    const overridable =
      USER_OVERRIDABLE_FLAG_KEYS as readonly SystemFlagKeyName[];
    const overrides = await this.userFlagsRepo.find({
      where: { userId, key: In([...overridable]) },
    });
    const byKey = new Map(overrides.map((o) => [o.key, o.value]));

    const rows: UserFlagAdminRow[] = [];
    for (const key of overridable) {
      const def = this.defs().find((d) => d.key === key);
      if (!def) continue;
      const systemValue = await this.getSystemRaw(key);
      const overrideValue = byKey.get(key) ?? null;
      rows.push({
        key,
        label: def.label,
        description: def.description,
        valueType: def.valueType,
        systemValue,
        overrideValue,
        effectiveValue: overrideValue ?? systemValue,
        options: this.optionsFor(key),
      });
    }
    return rows;
  }

  /**
   * Persist user overrides. `INHERIT` / empty clears override.
   */
  async setUserOverrides(
    userId: string,
    updates: Record<string, string>,
  ): Promise<void> {
    const allowed = new Set(USER_OVERRIDABLE_FLAG_KEYS as readonly string[]);
    for (const [key, raw] of Object.entries(updates)) {
      if (!allowed.has(key)) continue;
      const flagKey = key as SystemFlagKeyName;
      const def = this.defs().find((d) => d.key === flagKey);
      if (!def) continue;

      if (raw === INHERIT || raw === '' || raw === 'inherit') {
        await this.userFlagsRepo.delete({ userId, key: flagKey });
        this.logger.log(`Cleared user flag ${userId} ${flagKey}`);
        continue;
      }

      const normalized = this.normalizeValue(flagKey, def.valueType, raw);
      let row = await this.userFlagsRepo.findOne({
        where: { userId, key: flagKey },
      });
      if (!row) {
        row = this.userFlagsRepo.create({
          userId,
          key: flagKey,
          value: normalized,
        });
      } else {
        row.value = normalized;
      }
      await this.userFlagsRepo.save(row);
      this.logger.log(`User flag ${userId} ${flagKey}=${normalized}`);
    }
  }

  /** Admin view helpers for select options. */
  optionsFor(key: SystemFlagKeyName): string[] | null {
    if (key === SystemFlagKey.ROADMAP_ENGINE_MODE) {
      return [...ROADMAP_ENGINE_MODES];
    }
    if (key === SystemFlagKey.INTAKE_DEFAULT_MODE) {
      return [...INTAKE_MODES];
    }
    if (key === SystemFlagKey.LLM_PROVIDER) {
      return [...LLM_PROVIDER_IDS];
    }
    if (
      key === SystemFlagKey.LLM_INTAKE_MODEL ||
      key === SystemFlagKey.LLM_ROADMAP_MODEL ||
      key === SystemFlagKey.LLM_ARLO_MODEL ||
      key === SystemFlagKey.LLM_BATTLE_MODEL ||
      key === SystemFlagKey.LLM_LESSON_BODY_MODEL
    ) {
      return [...LLM_MODEL_OPTIONS];
    }
    return null;
  }

  /** Human label for admin selects (provider-aware). */
  optionLabel(key: SystemFlagKeyName, value: string): string {
    if (
      key === SystemFlagKey.LLM_INTAKE_MODEL ||
      key === SystemFlagKey.LLM_ROADMAP_MODEL ||
      key === SystemFlagKey.LLM_ARLO_MODEL ||
      key === SystemFlagKey.LLM_BATTLE_MODEL ||
      key === SystemFlagKey.LLM_LESSON_BODY_MODEL
    ) {
      return modelLabel(value);
    }
    return value;
  }

  private normalizeValue(
    key: SystemFlagKeyName,
    valueType: SystemFlagValueType,
    value: string,
  ): string {
    if (valueType === 'boolean') {
      const on = value === '1' || value === 'on' || value === 'true';
      return on ? 'true' : 'false';
    }
    const opts = this.optionsFor(key);
    const trimmed = value.trim();
    if (opts) {
      const match = opts.find((o) => o.toLowerCase() === trimmed.toLowerCase());
      if (!match) {
        throw new Error(`Invalid value for ${key}: ${value}`);
      }
      return match;
    }
    return trimmed.toLowerCase();
  }

  private envOr(envKey: string, fallback: string, allowed: string[]): string {
    const raw = (this.config.get<string>(envKey) ?? fallback)
      .trim()
      .toLowerCase();
    return allowed.includes(raw) ? raw : fallback;
  }

  /** First matching env among keys that is in LLM_MODEL_OPTIONS, else fallback. */
  private envModelOr(envKeys: string[], fallback: string): string {
    const allowed = [...LLM_MODEL_OPTIONS];
    for (const envKey of envKeys) {
      const raw = this.config.get<string>(envKey)?.trim();
      if (!raw) continue;
      const match = allowed.find((o) => o.toLowerCase() === raw.toLowerCase());
      if (match) return match;
    }
    return allowed.includes(fallback) ? fallback : DEFAULT_LLM_MODEL;
  }

  private envBoolDefault(envKey: string, fallback: boolean): string {
    const raw = this.config.get<string>(envKey);
    if (raw === undefined || raw === null || raw === '') {
      return fallback ? 'true' : 'false';
    }
    return raw !== 'false' ? 'true' : 'false';
  }
}
