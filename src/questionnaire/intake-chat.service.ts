import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import OpenAI from 'openai';
import { Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { LlmService } from '../common/llm/llm.service';
import { findProviderForModel } from '../common/llm/llm.providers';
import {
  Profile,
  QuestionnaireStatus,
} from '../profiles/entities/profile.entity';
import { RoleRecipe } from '../skill-graph/entities/role-recipe.entity';
import type { IntakeChatSelectionDto } from './dto/questionnaire.dto';
import {
  QuestionnaireResponse,
  QuestionnaireResponseStatus,
} from './entities/questionnaire-response.entity';
import {
  buildDeterministicAssistantMessage,
  buildIntakeChatSystemPrompt,
  buildIntakeChatUserPrompt,
  INTAKE_CHAT_PROMPT_VERSION,
} from './intake-chat.prompt';
import { parseIntakeChatLlmResponse } from './intake-chat.schema';
import {
  allowedValuesForStep,
  buildIntakeSuggestions,
  isFreeSkillToken,
  slugifySkillLabel,
  type IntakeSuggestionOption,
  type IntakeSuggestions,
} from './intake-chat.suggestions';
import { QuestionnaireSchemaService } from './questionnaire-schema.service';
import { QuestionnaireService } from './questionnaire.service';
import {
  listMissingFields,
  normalizeDraftAnswers,
} from './questionnaire.validation';
import {
  asString,
  emptyQuestionnaireAnswers,
  type QuestionnaireAnswers,
} from './types/answers';

export type ChatTurnResponse = {
  assistantMessage: string;
  answers: QuestionnaireAnswers;
  transcript: Array<{ role: 'user' | 'assistant'; content: string }>;
  missingFields: string[];
  done: boolean;
  promptVersion: string;
  model: string | null;
  /** Pickable chips for the current focus field (from schema / role recipes). */
  suggestions: IntakeSuggestions | null;
};

@Injectable()
export class IntakeChatService {
  private readonly logger = new Logger(IntakeChatService.name);
  /** Cache skill chips per goal (avoid rebuild every poll). */
  private readonly skillSuggestCache = new Map<
    string,
    { at: number; options: IntakeSuggestionOption[] }
  >();
  private static readonly SKILL_SUGGEST_TTL_MS = 15 * 60_000;

  constructor(
    private readonly llm: LlmService,
    private readonly schemaService: QuestionnaireSchemaService,
    private readonly questionnaireService: QuestionnaireService,
    @InjectRepository(QuestionnaireResponse)
    private readonly responsesRepo: Repository<QuestionnaireResponse>,
    @InjectRepository(Profile)
    private readonly profilesRepo: Repository<Profile>,
    @InjectRepository(RoleRecipe)
    private readonly recipesRepo: Repository<RoleRecipe>,
  ) {}

  async chatEnabled(userId?: string | null): Promise<boolean> {
    return this.questionnaireService.chatEnabled(userId);
  }

  private async assertChatEnabled(userId: string) {
    if (!(await this.chatEnabled(userId))) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'Conversational intake is disabled',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async start(userId: string): Promise<ChatTurnResponse> {
    await this.assertChatEnabled(userId);
    const schema = this.schemaService.getSchema();
    await this.markInProgress(userId);

    let row = await this.responsesRepo.findOne({ where: { userId } });
    if (!row) {
      row = this.responsesRepo.create({
        userId,
        answers: emptyQuestionnaireAnswers(),
        schemaVersion: schema.schemaVersion,
        goalId: null,
        submittedAt: null,
        status: QuestionnaireResponseStatus.Draft,
        chatTranscript: [],
      });
    }

    row.chatTranscript = [];
    if (row.status !== QuestionnaireResponseStatus.Submitted) {
      row.status = QuestionnaireResponseStatus.Draft;
      row.answers = emptyQuestionnaireAnswers();
    }
    await this.responsesRepo.save(row);

    return this.runTurn(userId, null, { isStart: true, skipLlm: true });
  }

  async message(
    userId: string,
    input: { message?: string; selection?: IntakeChatSelectionDto },
  ): Promise<ChatTurnResponse> {
    await this.assertChatEnabled(userId);
    const hasText = Boolean(input.message?.trim());
    const hasSelection = Boolean(input.selection?.fieldId);

    if (!hasText && !hasSelection) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'Message or selection is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.markInProgress(userId);

    if (input.selection) {
      return this.applySelectionAndContinue(userId, input.selection);
    }

    // Career goal must use chip selection — no free-typed path.
    const schema = this.schemaService.getSchema();
    const row = await this.responsesRepo.findOne({ where: { userId } });
    const answers = normalizeDraftAnswers(row?.answers ?? {}, schema);
    const pending = await this.suggestionsFor(userId, answers);
    if (pending?.fieldId === 'goal') {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        pending.selection === 'multi'
          ? 'Pick one or more listed career paths — free text is disabled for this step'
          : 'Pick a listed career path — free text is disabled for this step',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.runTurn(userId, input.message!.trim().slice(0, 400), {
      isStart: false,
      skipLlm: false,
    });
  }

  async complete(userId: string) {
    await this.assertChatEnabled(userId);
    const schema = this.schemaService.getSchema();
    const row = await this.responsesRepo.findOne({ where: { userId } });
    if (!row) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'No chat draft found — start intake first',
        HttpStatus.BAD_REQUEST,
      );
    }

    const answers = normalizeDraftAnswers(row.answers, schema);
    const missing = listMissingFields(answers, schema);
    if (missing.length) {
      return {
        ok: false as const,
        missingFields: missing,
        answers,
        transcript: row.chatTranscript ?? [],
        suggestions: await this.suggestionsFor(userId, answers),
      };
    }

    const result = await this.questionnaireService.submit(userId, answers);
    return {
      ok: true as const,
      missingFields: [] as string[],
      suggestions: null,
      ...result,
    };
  }

  async getState(userId: string): Promise<ChatTurnResponse> {
    await this.assertChatEnabled(userId);
    const schema = this.schemaService.getSchema();
    const row = await this.responsesRepo.findOne({ where: { userId } });
    const answers = normalizeDraftAnswers(row?.answers ?? {}, schema);
    const transcript = row?.chatTranscript ?? [];
    const missing = listMissingFields(answers, schema);
    const lastAssistant = [...transcript]
      .reverse()
      .find((m) => m.role === 'assistant');
    return {
      assistantMessage:
        lastAssistant?.content ??
        'Say hi when you are ready to start your goal interview.',
      answers,
      transcript,
      missingFields: missing,
      done: missing.length === 0,
      promptVersion: INTAKE_CHAT_PROMPT_VERSION,
      model: null,
      suggestions: await this.suggestionsFor(userId, answers),
    };
  }

  /** Validate chip selection against schema (+ role recipes for goal). */
  private async applySelectionAndContinue(
    userId: string,
    selection: IntakeChatSelectionDto,
  ): Promise<ChatTurnResponse> {
    const schema = this.schemaService.getSchema();
    const step = schema.steps.find((s) => s.id === selection.fieldId);
    if (!step) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        `Unknown field: ${selection.fieldId}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    let row = await this.responsesRepo.findOne({ where: { userId } });
    if (!row) {
      row = this.responsesRepo.create({
        userId,
        answers: emptyQuestionnaireAnswers(),
        schemaVersion: schema.schemaVersion,
        goalId: null,
        submittedAt: null,
        status: QuestionnaireResponseStatus.Draft,
        chatTranscript: [],
      });
    }

    const prior = normalizeDraftAnswers(row.answers ?? {}, schema);
    const patch: QuestionnaireAnswers = { ...prior };
    let display = '';

    if (step.uiKind === 'schedule') {
      const daysAllowed = new Set(step.scheduleDays ?? []);
      const timesAllowed = new Set(
        (step.scheduleTimes ?? []).map((t) => t.value),
      );
      const days = (selection.days ?? []).filter((d) => daysAllowed.has(d));
      const times = (selection.times ?? selection.values ?? []).filter((t) =>
        timesAllowed.has(t),
      );
      if (!days.length || !times.length) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          'Schedule requires at least one valid day and time',
          HttpStatus.BAD_REQUEST,
        );
      }
      patch[step.id] = { days, times };
      display = `Schedule: ${days.join(', ')} · ${times.join(', ')}`;
    } else {
      const allowed = new Set(allowedValuesForStep(step));
      if (step.id === 'goal') {
        for (const role of await this.listActiveRoleOptions()) {
          allowed.add(role.value);
        }
      }

      let values = selection.values.map((v) => v.trim()).filter(Boolean);

      if (step.id === 'goal') {
        // Career path must be a listed role — never free "other".
        values = values.filter((v) => v !== 'other');
      }

      if (step.id === 'skills') {
        values = values.filter(
          (v) =>
            v === 'none' ||
            v === 'other' ||
            isFreeSkillToken(v) ||
            allowed.has(v),
        );
        if (values.includes('none') && values.length > 1) {
          values = ['none'];
        }
      } else {
        values = values.filter((v) => allowed.has(v));
      }

      if (!values.length) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          `Invalid ${step.id} selection — pick a listed option`,
          HttpStatus.BAD_REQUEST,
        );
      }

      if (step.selection === 'multi') {
        patch[step.id] = values;
      } else {
        patch[step.id] = values[0]!;
      }

      if (values.includes('other') && selection.otherText?.trim()) {
        patch[`${step.id}Other`] = selection.otherText.trim();
      }

      const labelByValue = new Map([
        ...step.options.map((o) => [o.value, o.label] as const),
        ...(await this.listActiveRoleOptions()).map(
          (o) => [o.value, o.label] as const,
        ),
      ]);
      if (step.id === 'skills') {
        const goal =
          asString(prior, 'goal').trim() || asString(prior, 'goalOther').trim();
        const cached = goal ? this.skillSuggestCache.get(goal) : undefined;
        for (const o of cached?.options ?? []) {
          labelByValue.set(o.value, o.label);
        }
      }
      display = values
        .map((v) =>
          v === 'other' && selection.otherText?.trim()
            ? selection.otherText.trim()
            : (labelByValue.get(v) ?? v),
        )
        .join(', ');
    }

    const answers = normalizeDraftAnswers(patch, schema);
    row.answers = answers;
    row.schemaVersion = schema.schemaVersion;
    if (row.status !== QuestionnaireResponseStatus.Submitted) {
      row.status = QuestionnaireResponseStatus.Draft;
    }
    await this.responsesRepo.save(row);

    // Chip/schedule already applied — skip LLM (next Q from schema title).
    return this.runTurn(userId, display, {
      isStart: false,
      skipLlm: true,
      preAnswers: answers,
    });
  }

  private async runTurn(
    userId: string,
    userMessage: string | null,
    opts: {
      isStart: boolean;
      skipLlm: boolean;
      preAnswers?: QuestionnaireAnswers;
    },
  ): Promise<ChatTurnResponse> {
    const { isStart, skipLlm, preAnswers } = opts;
    const schema = this.schemaService.getSchema();
    let row = await this.responsesRepo.findOne({ where: { userId } });
    if (!row) {
      row = this.responsesRepo.create({
        userId,
        answers: emptyQuestionnaireAnswers(),
        schemaVersion: schema.schemaVersion,
        goalId: null,
        submittedAt: null,
        status: QuestionnaireResponseStatus.Draft,
        chatTranscript: [],
      });
    }

    const priorAnswers = normalizeDraftAnswers(
      preAnswers ?? row.answers ?? {},
      schema,
    );
    const missingBefore = listMissingFields(priorAnswers, schema);
    const transcript = [...(row.chatTranscript ?? [])];
    if (userMessage) {
      transcript.push({ role: 'user', content: userMessage });
    }

    const withSuggestions = async (
      partial: Omit<ChatTurnResponse, 'suggestions'>,
      answers: QuestionnaireAnswers,
    ): Promise<ChatTurnResponse> => ({
      ...partial,
      suggestions: partial.done
        ? null
        : await this.suggestionsFor(userId, answers),
    });

    // Chip/start/done — ask from schema title, zero LLM tokens.
    if (skipLlm || (!isStart && missingBefore.length === 0)) {
      const assistantMessage = buildDeterministicAssistantMessage(
        schema,
        priorAnswers,
        { isStart },
      );
      const done = missingBefore.length === 0;
      transcript.push({ role: 'assistant', content: assistantMessage });
      row.answers = priorAnswers;
      row.schemaVersion = schema.schemaVersion;
      row.chatTranscript = transcript;
      if (row.status !== QuestionnaireResponseStatus.Submitted) {
        row.status = QuestionnaireResponseStatus.Draft;
      }
      await this.responsesRepo.save(row);
      return withSuggestions(
        {
          assistantMessage,
          answers: priorAnswers,
          transcript,
          missingFields: missingBefore,
          done,
          promptVersion: INTAKE_CHAT_PROMPT_VERSION,
          model: null,
        },
        priorAnswers,
      );
    }

    const clientConfigured = this.llm.isConfigured();
    let model = await this.llm.getModel('intake');
    const provider = findProviderForModel(model);
    this.logger.log(
      `[intake-llm] start user=${userId} model=${model} provider=${provider?.id ?? 'unknown'} base=${provider?.baseURL ?? '?'} configured=${clientConfigured}`,
    );

    if (!clientConfigured) {
      const fallback =
        'LLM is not configured. Switch to form intake, or set CEREBRAS_API_KEY / provider API key.';
      transcript.push({ role: 'assistant', content: fallback });
      row.chatTranscript = transcript;
      row.answers = priorAnswers;
      await this.responsesRepo.save(row);
      return withSuggestions(
        {
          assistantMessage: fallback,
          answers: priorAnswers,
          transcript,
          missingFields: missingBefore,
          done: false,
          promptVersion: INTAKE_CHAT_PROMPT_VERSION,
          model: null,
        },
        priorAnswers,
      );
    }

    const system = buildIntakeChatSystemPrompt(schema, priorAnswers);
    const user = buildIntakeChatUserPrompt({
      transcript,
      partialAnswers: priorAnswers,
      missingFields: missingBefore,
      userMessage: isStart ? null : userMessage,
    });

    try {
      const { content, modelUsed } = await this.completeWithFallback(
        userId,
        model,
        system,
        user,
      );
      model = modelUsed;

      const parsed = parseIntakeChatLlmResponse(JSON.parse(content));
      const mergedRaw = {
        ...priorAnswers,
        ...(parsed.partialAnswers ?? {}),
      };
      const answers = normalizeDraftAnswers(mergedRaw, schema);
      const missing = listMissingFields(answers, schema);
      const assistantMessage = parsed.assistantMessage.trim().slice(0, 200);

      transcript.push({ role: 'assistant', content: assistantMessage });
      row.answers = answers;
      row.schemaVersion = schema.schemaVersion;
      row.chatTranscript = transcript;
      if (row.status !== QuestionnaireResponseStatus.Submitted) {
        row.status = QuestionnaireResponseStatus.Draft;
      }
      await this.responsesRepo.save(row);

      return withSuggestions(
        {
          assistantMessage,
          answers,
          transcript,
          missingFields: missing,
          done: missing.length === 0 && parsed.done,
          promptVersion: INTAKE_CHAT_PROMPT_VERSION,
          model,
        },
        answers,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[intake-llm] soft-fail model=${model} provider=${findProviderForModel(model)?.id ?? '?'}: ${message}`,
      );
      const fallback = this.userFacingLlmError(message, model);
      transcript.push({ role: 'assistant', content: fallback });
      row.answers = priorAnswers;
      row.chatTranscript = transcript;
      await this.responsesRepo.save(row);
      return withSuggestions(
        {
          assistantMessage: fallback,
          answers: priorAnswers,
          transcript,
          missingFields: missingBefore,
          done: false,
          promptVersion: INTAKE_CHAT_PROMPT_VERSION,
          model,
        },
        priorAnswers,
      );
    }
  }

  private async suggestionsFor(
    userId: string,
    answers: QuestionnaireAnswers,
  ): Promise<IntakeSuggestions | null> {
    const schema = this.schemaService.getSchema();
    const base = buildIntakeSuggestions(schema, answers);
    if (!base) return null;

    if (base.fieldId === 'goal') {
      const roles = await this.listActiveRoleOptions();
      if (roles.length) {
        const byValue = new Map<string, { value: string; label: string }>();
        for (const o of [...roles, ...base.options]) {
          if (o.value === 'other') continue;
          if (!byValue.has(o.value)) byValue.set(o.value, o);
        }
        return {
          ...base,
          // Career path = catalog only (role recipes / schema). No custom type-in.
          allowOther: false,
          options: [...byValue.values()],
        };
      }
      return {
        ...base,
        allowOther: false,
        options: base.options.filter((o) => o.value !== 'other'),
      };
    }

    if (base.fieldId === 'skills') {
      return this.aiSkillSuggestions(userId, base, answers);
    }

    return base;
  }

  /** Goal-keyed skill chips — deterministic pools (no LLM). */
  private async aiSkillSuggestions(
    userId: string,
    base: IntakeSuggestions,
    answers: QuestionnaireAnswers,
  ): Promise<IntakeSuggestions> {
    void userId;
    const goal =
      asString(answers, 'goal').trim() || asString(answers, 'goalOther').trim();
    const sentinels: IntakeSuggestionOption[] = [
      { value: 'none', label: 'None of the above' },
      ...(base.allowOther ? [{ value: 'other', label: 'Other' }] : []),
    ];

    if (!goal) {
      return { ...base, options: sentinels };
    }

    const cached = this.skillSuggestCache.get(goal);
    if (
      cached &&
      Date.now() - cached.at < IntakeChatService.SKILL_SUGGEST_TTL_MS
    ) {
      return { ...base, options: [...cached.options, ...sentinels] };
    }

    const options = this.fallbackSkillSuggestions(goal).slice(0, 8);
    this.skillSuggestCache.set(goal, { at: Date.now(), options });
    return { ...base, options: [...options, ...sentinels] };
  }

  /** Goal → 8 skill chips. No LLM — covers seed roles + soft fallback. */
  private fallbackSkillSuggestions(goal: string): IntakeSuggestionOption[] {
    const g = goal.toLowerCase();
    let labels: string[];
    if (/front|react|ui|ux-design|ux_designer|designer/.test(g)) {
      labels = [
        'HTML',
        'CSS',
        'JavaScript',
        'React',
        'TypeScript',
        'Git',
        'Responsive Design',
        'Figma',
      ];
    } else if (/mobile|ios|android|flutter|react-native/.test(g)) {
      labels = [
        'JavaScript',
        'React Native',
        'Swift',
        'Kotlin',
        'Git',
        'REST APIs',
        'UI Design',
        'Debugging',
      ];
    } else if (/full.?stack|fullstack/.test(g)) {
      labels = [
        'HTML',
        'CSS',
        'JavaScript',
        'React',
        'Node.js',
        'SQL',
        'Git',
        'APIs',
      ];
    } else if (/back|api|node|java|devops|cloud|server/.test(g)) {
      labels = [
        'JavaScript',
        'APIs',
        'SQL',
        'Git',
        'Linux',
        'Docker',
        'Testing',
        'Problem Solving',
      ];
    } else if (/data|analy|ml|ai|python/.test(g)) {
      labels = [
        'Excel',
        'SQL',
        'Python',
        'Statistics',
        'Data Visualization',
        'Pandas',
        'Communication',
        'Problem Solving',
      ];
    } else if (/market/.test(g)) {
      labels = [
        'Copywriting',
        'SEO',
        'Social Media',
        'Analytics',
        'Email Marketing',
        'Communication',
        'Research',
        'Content Strategy',
      ];
    } else if (/product/.test(g)) {
      labels = [
        'Research',
        'Communication',
        'Prioritization',
        'Analytics',
        'Wireframing',
        'Stakeholder Mgmt',
        'Writing',
        'Problem Solving',
      ];
    } else {
      labels = [
        'Communication',
        'Problem Solving',
        'Writing',
        'Research',
        'Time Management',
        'Collaboration',
        'Critical Thinking',
        'Learning Agility',
      ];
    }
    return labels.map((label) => ({
      value: slugifySkillLabel(label),
      label,
    }));
  }

  private async listActiveRoleOptions(): Promise<
    Array<{ value: string; label: string }>
  > {
    try {
      const recipes = await this.recipesRepo.find({
        where: { isActive: true },
        order: { title: 'ASC' },
        take: 40,
      });
      return recipes.map((r) => ({
        value: r.targetRoleSlug,
        label: r.title,
      }));
    } catch (err) {
      this.logger.warn(
        `Role recipe lookup failed: ${err instanceof Error ? err.message : err}`,
      );
      return [];
    }
  }

  private async completeWithFallback(
    userId: string,
    model: string,
    system: string,
    user: string,
  ): Promise<{ content: string; modelUsed: string }> {
    const fallbacks = this.llm.isOpenRouter()
      ? this.llm.getIntakeFallbackModels(model)
      : [];

    try {
      return await this.callChat(userId, model, system, user, fallbacks);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this.isRateLimited(msg) || /quota/i.test(msg)) {
        throw new Error(
          `LLM rate/quota limit — wait, switch model, or check billing. (${msg})`,
        );
      }
      throw err;
    }
  }

  private async callChat(
    userId: string,
    model: string,
    system: string,
    user: string,
    fallbackModels: string[] = [],
  ): Promise<{ content: string; modelUsed: string }> {
    const body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & {
      models?: string[];
    } = {
      model,
      temperature: 0.3,
      max_tokens: 180,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };
    if (fallbackModels.length) {
      body.models = fallbackModels;
    }

    const completion = await this.llm.chatCompletion({
      purpose: 'intake',
      userId,
      request: body,
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('empty_response');
    const modelUsed =
      typeof completion.model === 'string' && completion.model
        ? completion.model
        : model;
    this.logger.log(
      `[intake-llm] ok model=${modelUsed} tokens=${completion.usage?.total_tokens ?? '?'}`,
    );
    return { content, modelUsed };
  }

  private isRateLimited(message: string): boolean {
    return (
      /\b429\b/i.test(message) ||
      /rate.?limit/i.test(message) ||
      /exceeded your current quota/i.test(message)
    );
  }

  private userFacingLlmError(message: string, model?: string): string {
    if (/models' array must have 3/i.test(message)) {
      return 'AI config error (too many fallback models). Try again in a moment.';
    }
    if (this.isRateLimited(message) || /rate\/quota/i.test(message)) {
      const who = model
        ? `${model} (${findProviderForModel(model)?.label ?? 'provider'})`
        : 'the current model';
      return `AI rate-limited on ${who}. Wait a minute and retry, or switch model in Admin → Feature flags.`;
    }
    if (/400\b/.test(message)) {
      return `AI request rejected: ${message.replace(/^Error:\s*/i, '').slice(0, 160)}`;
    }
    return 'I had trouble reading that. Could you rephrase? Or switch to the form intake.';
  }

  private async markInProgress(userId: string) {
    const profile = await this.profilesRepo.findOne({ where: { userId } });
    if (
      profile &&
      profile.questionnaireStatus === QuestionnaireStatus.NotStarted
    ) {
      profile.questionnaireStatus = QuestionnaireStatus.InProgress;
      await this.profilesRepo.save(profile);
    }
  }
}
