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
import { UnitsCatalogService } from '../content-pool/units-catalog.service';
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
  humanizeSkillSlug,
  isFreeSkillToken,
  listChatPendingFields,
  slugifySkillLabel,
  type IntakeChatMeta,
  type IntakeSuggestionOption,
  type IntakeSuggestions,
} from './intake-chat.suggestions';
import { QuestionnaireSchemaService } from './questionnaire-schema.service';
import { QuestionnaireService } from './questionnaire.service';
import type { QuestionnaireStepDto } from './schema/schema.types';
import {
  listMissingFields,
  normalizeDraftAnswers,
} from './questionnaire.validation';
import {
  asSkillEvidence,
  asString,
  asTrackSelection,
  emptyQuestionnaireAnswers,
  isSkillEvidenceAnswer,
  type QuestionnaireAnswers,
  type SkillEvidenceAnswer,
} from './types/answers';

export type ChatTurnResponse = {
  assistantMessage: string;
  answers: QuestionnaireAnswers;
  transcript: Array<{ role: 'user' | 'assistant'; content: string }>;
  missingFields: string[];
  done: boolean;
  promptVersion: string;
  model: string | null;
  /** Pickable chips for the current focus (sub)question. */
  suggestions: IntakeSuggestions | null;
};

@Injectable()
export class IntakeChatService {
  private readonly logger = new Logger(IntakeChatService.name);
  /** Internal chat progress markers stored inside the answers JSON. */
  private static readonly CHAT_META_KEY = '_chatMeta';
  /** Cache skill chips per primary track (avoid rebuild every poll). */
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
    private readonly unitsCatalog: UnitsCatalogService,
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

  // ---------------------------------------------------------------- meta

  private readMeta(raw: unknown): IntakeChatMeta {
    if (!raw || typeof raw !== 'object') return {};
    const meta = (raw as Record<string, unknown>)[
      IntakeChatService.CHAT_META_KEY
    ];
    if (!meta || typeof meta !== 'object') return {};
    const m = meta as Record<string, unknown>;
    return {
      skillsAnswered: m.skillsAnswered === true,
      exposureDone: Array.isArray(m.exposureDone)
        ? m.exposureDone.filter((s): s is string => typeof s === 'string')
        : [],
      sessionAnswered: m.sessionAnswered === true,
    };
  }

  private withMeta(
    answers: QuestionnaireAnswers,
    meta: IntakeChatMeta,
  ): QuestionnaireAnswers {
    return { ...answers, [IntakeChatService.CHAT_META_KEY]: meta };
  }

  /** Meta for answers finished elsewhere (e.g. already-submitted rows). */
  private completedMeta(answers: QuestionnaireAnswers): IntakeChatMeta {
    return {
      skillsAnswered: true,
      sessionAnswered: true,
      exposureDone: asSkillEvidence(answers, 'skills').map((e) => e.skillSlug),
    };
  }

  private chatPending(
    answers: QuestionnaireAnswers,
    meta: IntakeChatMeta,
  ): string[] {
    const schema = this.schemaService.getSchema();
    return listChatPendingFields(
      schema,
      answers,
      meta,
      listMissingFields(answers, schema),
    );
  }

  // ---------------------------------------------------------------- flow

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
    if (row.status === QuestionnaireResponseStatus.Submitted) {
      // Keep submitted answers; mark chat-only questions as already covered.
      const answers = normalizeDraftAnswers(row.answers ?? {}, schema);
      row.answers = this.withMeta(answers, this.completedMeta(answers));
    } else {
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

    // Track selection must use chip picks — no free-typed path.
    const schema = this.schemaService.getSchema();
    const row = await this.responsesRepo.findOne({ where: { userId } });
    const meta = this.readMeta(row?.answers);
    const answers = normalizeDraftAnswers(row?.answers ?? {}, schema);
    const pending = await this.suggestionsFor(userId, answers, meta);
    if (pending?.fieldId === 'goal') {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'Pick listed career paths — first pick becomes your primary track; free text is disabled for this step',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.runTurn(userId, input.message!.trim().slice(0, 400), {
      isStart: false,
      skipLlm: false,
    });
  }

  /**
   * Wrap up the chat draft.
   *
   * Preferred flow: saves the normalized draft and returns
   * `{ readyForReview: true, answers, incompleteFields }` so the client
   * routes the user to the review screen; the final submit happens via
   * `POST /questionnaire/submit`.
   *
   * Backward compat: pass `{ submit: true }` to submit immediately when the
   * draft is already complete (legacy clients). Review is still preferred.
   */
  async complete(userId: string, opts: { submit?: boolean } = {}) {
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

    const meta = this.readMeta(row.answers);
    const answers = normalizeDraftAnswers(row.answers, schema);
    const missing = listMissingFields(answers, schema);

    // Persist the normalized draft so the review screen reads a clean snapshot.
    row.answers = this.withMeta(answers, meta);
    row.schemaVersion = schema.schemaVersion;
    if (row.status !== QuestionnaireResponseStatus.Submitted) {
      row.status = QuestionnaireResponseStatus.Draft;
    }
    await this.responsesRepo.save(row);

    if (opts.submit && !missing.length) {
      // Legacy immediate-submit path.
      const result = await this.questionnaireService.submit(userId, answers);
      return {
        ok: true as const,
        readyForReview: false,
        missingFields: [] as string[],
        incompleteFields: [] as string[],
        suggestions: null,
        ...result,
      };
    }

    return {
      ok: missing.length === 0,
      readyForReview: true,
      answers,
      incompleteFields: missing,
      /** @deprecated alias of incompleteFields kept for older clients */
      missingFields: missing,
      transcript: row.chatTranscript ?? [],
      suggestions: missing.length
        ? await this.suggestionsFor(userId, answers, meta)
        : null,
    };
  }

  async getState(userId: string): Promise<ChatTurnResponse> {
    await this.assertChatEnabled(userId);
    const schema = this.schemaService.getSchema();
    const row = await this.responsesRepo.findOne({ where: { userId } });
    const meta = this.readMeta(row?.answers);
    const answers = normalizeDraftAnswers(row?.answers ?? {}, schema);
    const transcript = row?.chatTranscript ?? [];
    const pending = this.chatPending(answers, meta);
    const lastAssistant = [...transcript]
      .reverse()
      .find((m) => m.role === 'assistant');
    return {
      assistantMessage:
        lastAssistant?.content ??
        'Say hi when you are ready to start your goal interview.',
      answers,
      transcript,
      missingFields: pending,
      done: pending.length === 0,
      promptVersion: INTAKE_CHAT_PROMPT_VERSION,
      model: null,
      suggestions: pending.length
        ? await this.suggestionsFor(userId, answers, meta)
        : null,
    };
  }

  // ----------------------------------------------------------- selections

  /** Validate chip selection against schema v4 structured answers. */
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

    const meta = this.readMeta(row.answers);
    const prior = normalizeDraftAnswers(row.answers ?? {}, schema);
    const patch: QuestionnaireAnswers = { ...prior };
    let display = '';

    const values = selection.values.map((v) => v.trim()).filter(Boolean);

    switch (step.uiKind) {
      case 'schedule':
        display = this.applyScheduleSelection(step, selection, patch);
        break;
      case 'track-select':
        display = await this.applyTrackSelection(step, values, patch);
        break;
      case 'skill-evidence':
        display = this.applySkillSelection(
          step,
          selection,
          values,
          prior,
          patch,
          meta,
        );
        break;
      case 'capacity':
        display = this.applyCapacitySelection(
          step,
          selection,
          values,
          prior,
          patch,
          meta,
        );
        break;
      case 'outcome':
        display = this.applyOutcomeSelection(step, selection, values, prior, patch);
        break;
      case 'context':
        display = this.applyContextSelection(step, selection, values, prior, patch);
        break;
      case 'confidence-barriers':
        display = this.applyConfidenceBarriersSelection(
          step,
          selection,
          values,
          prior,
          patch,
        );
        break;
      default:
        display = this.applyPlainOptionsSelection(step, selection, values, patch);
        break;
    }

    const answers = normalizeDraftAnswers(patch, schema);
    row.answers = this.withMeta(answers, meta);
    row.schemaVersion = schema.schemaVersion;
    if (row.status !== QuestionnaireResponseStatus.Submitted) {
      row.status = QuestionnaireResponseStatus.Draft;
    }
    await this.responsesRepo.save(row);

    // Chip already applied — skip LLM (next question from schema/suggestions).
    return this.runTurn(userId, display, {
      isStart: false,
      skipLlm: true,
      preAnswers: answers,
      preMeta: meta,
    });
  }

  private applyScheduleSelection(
    step: QuestionnaireStepDto,
    selection: IntakeChatSelectionDto,
    patch: QuestionnaireAnswers,
  ): string {
    const timesAllowed = new Set((step.scheduleTimes ?? []).map((t) => t.value));
    const times = (selection.times ?? selection.values ?? []).filter((t) =>
      timesAllowed.has(t),
    );
    if (!times.length) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'Schedule requires at least one valid time of day',
        HttpStatus.BAD_REQUEST,
      );
    }
    // Days retired from intake — empty array keeps answer shape stable.
    patch[step.id] = { days: [], times };
    return `Schedule: ${times.join(', ')}`;
  }

  /** Multi pick — first value is the primary track, rest are secondary. */
  private async applyTrackSelection(
    step: QuestionnaireStepDto,
    values: string[],
    patch: QuestionnaireAnswers,
  ): Promise<string> {
    const roles = await this.listActiveRoleOptions();
    const allowed = new Set(step.options.map((o) => o.value));
    for (const role of roles) allowed.add(role.value);

    const picked = values.filter((v) => v !== 'other' && allowed.has(v));
    if (!picked.length) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'Pick a listed career path — the first pick becomes your primary track',
        HttpStatus.BAD_REQUEST,
      );
    }
    const primary = picked[0]!;
    const secondary = [...new Set(picked.slice(1))].filter(
      (v) => v !== primary,
    );
    patch[step.id] = { primary, secondary };

    const labelByValue = new Map([
      ...step.options.map((o) => [o.value, o.label] as const),
      ...roles.map((o) => [o.value, o.label] as const),
    ]);
    const label = (v: string) => labelByValue.get(v) ?? v;
    return secondary.length
      ? `Primary: ${label(primary)} · Also: ${secondary.map(label).join(', ')}`
      : `Primary: ${label(primary)}`;
  }

  /**
   * Two-phase skill-evidence:
   * 1. skill picks (multi) → evidence entries with default exposure;
   * 2. per-skill exposure (single, `skillSlug` set) → update that entry.
   */
  private applySkillSelection(
    step: QuestionnaireStepDto,
    selection: IntakeChatSelectionDto,
    values: string[],
    prior: QuestionnaireAnswers,
    patch: QuestionnaireAnswers,
    meta: IntakeChatMeta,
  ): string {
    const exposureAllowed = (step.exposureOptions ?? []).map((o) => o.value);
    const defaultExposure = exposureAllowed[0] ?? 'heard_of';

    // Phase 2 — exposure for one selected skill.
    if (selection.skillSlug || selection.subField === 'exposure') {
      const skillSlug = selection.skillSlug?.trim() ?? '';
      const exposure = values[0] ?? '';
      if (!skillSlug || !exposureAllowed.includes(exposure)) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          'Exposure selection requires a known skill and a listed level',
          HttpStatus.BAD_REQUEST,
        );
      }
      const entries = asSkillEvidence(prior, step.id);
      const target = entries.find((e) => e.skillSlug === skillSlug);
      if (!target) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          `Skill ${skillSlug} is not in your selected skills`,
          HttpStatus.BAD_REQUEST,
        );
      }
      target.exposureLevel = exposure;
      patch[step.id] = entries;
      meta.exposureDone = [
        ...new Set([...(meta.exposureDone ?? []), skillSlug]),
      ];
      const exposureLabel =
        (step.exposureOptions ?? []).find((o) => o.value === exposure)
          ?.label ?? exposure;
      return `${this.skillLabel(step, skillSlug)}: ${exposureLabel}`;
    }

    // Phase 1 — skill picks.
    const allowed = new Set(allowedValuesForStep(step));
    let picked = values.filter(
      (v) =>
        v === 'none' || v === 'other' || isFreeSkillToken(v) || allowed.has(v),
    );
    if (picked.includes('none') && picked.length > 1) {
      picked = ['none'];
    }
    if (!picked.length) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        `Invalid ${step.id} selection — pick a listed option`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const priorExposure = new Map(
      asSkillEvidence(prior, step.id).map(
        (e) => [e.skillSlug, e.exposureLevel] as const,
      ),
    );
    const slugs = [...new Set(picked.filter((v) => v !== 'none' && v !== 'other'))];
    if (picked.includes('other') && selection.otherText?.trim()) {
      const otherText = selection.otherText.trim();
      patch[`${step.id}Other`] = otherText;
      const slug = slugifySkillLabel(otherText);
      if (!slugs.includes(slug)) slugs.push(slug);
    }
    patch[step.id] = slugs.map(
      (skillSlug): SkillEvidenceAnswer => ({
        skillSlug,
        exposureLevel: priorExposure.get(skillSlug) ?? defaultExposure,
      }),
    );
    meta.skillsAnswered = true;
    // Only keep exposure progress for skills that are still selected.
    meta.exposureDone = (meta.exposureDone ?? []).filter((s) =>
      slugs.includes(s),
    );

    if (!slugs.length) return 'Skills: none yet';
    return `Skills: ${slugs.map((s) => this.skillLabel(step, s)).join(', ')}`;
  }

  /** studyHours first, then preferredSessionMinutes. */
  private applyCapacitySelection(
    step: QuestionnaireStepDto,
    selection: IntakeChatSelectionDto,
    values: string[],
    prior: QuestionnaireAnswers,
    patch: QuestionnaireAnswers,
    meta: IntakeChatMeta,
  ): string {
    const hoursAllowed = new Set(step.options.map((o) => o.value));
    const sessionAllowed = new Set(
      (step.sessionOptions ?? []).map((o) => o.value),
    );
    const value = values[0] ?? '';
    const isSession =
      selection.subField === 'preferredSessionMinutes' ||
      (!hoursAllowed.has(value) && sessionAllowed.has(value)) ||
      (Boolean(asString(prior, step.id)) && sessionAllowed.has(value));

    if (isSession) {
      if (!sessionAllowed.has(value)) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          'Pick a listed session length',
          HttpStatus.BAD_REQUEST,
        );
      }
      patch.preferredSessionMinutes = value;
      meta.sessionAnswered = true;
      const label =
        (step.sessionOptions ?? []).find((o) => o.value === value)?.label ??
        `${value} minutes`;
      return `Session length: ${label}`;
    }

    if (!hoursAllowed.has(value)) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        `Invalid ${step.id} selection — pick a listed option`,
        HttpStatus.BAD_REQUEST,
      );
    }
    patch[step.id] = value;
    const label = step.options.find((o) => o.value === value)?.label ?? value;
    return `Weekly time: ${label}`;
  }

  /** targetOutcome first, then deadline. */
  private applyOutcomeSelection(
    step: QuestionnaireStepDto,
    selection: IntakeChatSelectionDto,
    values: string[],
    prior: QuestionnaireAnswers,
    patch: QuestionnaireAnswers,
  ): string {
    const outcomeAllowed = new Set(step.options.map((o) => o.value));
    const deadlineAllowed = new Set(
      (step.secondaryOptions ?? []).map((o) => o.value),
    );
    const value = values[0] ?? '';
    const isDeadline =
      selection.subField === 'deadline' ||
      (!outcomeAllowed.has(value) && deadlineAllowed.has(value)) ||
      (Boolean(asString(prior, step.id)) && deadlineAllowed.has(value));

    if (isDeadline) {
      if (!deadlineAllowed.has(value)) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          'Pick a listed deadline',
          HttpStatus.BAD_REQUEST,
        );
      }
      patch.deadline = value;
      const label =
        (step.secondaryOptions ?? []).find((o) => o.value === value)?.label ??
        value;
      return `Deadline: ${label}`;
    }

    if (!outcomeAllowed.has(value)) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        `Invalid ${step.id} selection — pick a listed option`,
        HttpStatus.BAD_REQUEST,
      );
    }
    patch[step.id] = value;
    const label = step.options.find((o) => o.value === value)?.label ?? value;
    return `Outcome: ${label}`;
  }

  /** currentContext first, then useFrequency. */
  private applyContextSelection(
    step: QuestionnaireStepDto,
    selection: IntakeChatSelectionDto,
    values: string[],
    prior: QuestionnaireAnswers,
    patch: QuestionnaireAnswers,
  ): string {
    const contextAllowed = new Set(allowedValuesForStep(step));
    const freqAllowed = new Set(
      (step.secondaryOptions ?? []).map((o) => o.value),
    );
    const value = values[0] ?? '';
    const hasContext =
      Boolean(asString(prior, step.id)) ||
      Boolean(asString(prior, `${step.id}Other`).trim());
    const isFrequency =
      selection.subField === 'useFrequency' ||
      (!contextAllowed.has(value) && freqAllowed.has(value)) ||
      (hasContext && freqAllowed.has(value));

    if (isFrequency) {
      if (!freqAllowed.has(value)) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          'Pick a listed usage frequency',
          HttpStatus.BAD_REQUEST,
        );
      }
      patch.useFrequency = value;
      const label =
        (step.secondaryOptions ?? []).find((o) => o.value === value)?.label ??
        value;
      return `Usage: ${label}`;
    }

    if (!contextAllowed.has(value)) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        `Invalid ${step.id} selection — pick a listed option`,
        HttpStatus.BAD_REQUEST,
      );
    }
    patch[step.id] = value;
    if (value === 'other' && selection.otherText?.trim()) {
      patch[`${step.id}Other`] = selection.otherText.trim();
    }
    const label =
      value === 'other' && selection.otherText?.trim()
        ? selection.otherText.trim()
        : (step.options.find((o) => o.value === value)?.label ?? value);
    return `Context: ${label}`;
  }

  /** confidence (single) first, then barriers (multi). */
  private applyConfidenceBarriersSelection(
    step: QuestionnaireStepDto,
    selection: IntakeChatSelectionDto,
    values: string[],
    prior: QuestionnaireAnswers,
    patch: QuestionnaireAnswers,
  ): string {
    const confidenceAllowed = new Set(step.options.map((o) => o.value));
    const barrierAllowed = new Set(
      (step.secondaryOptions ?? []).map((o) => o.value),
    );
    const isConfidence =
      selection.subField === 'confidence' ||
      (!asString(prior, 'confidence') &&
        values.some((v) => confidenceAllowed.has(v)));

    if (isConfidence) {
      const value = values.find((v) => confidenceAllowed.has(v)) ?? '';
      if (!value) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          'Pick a listed confidence level',
          HttpStatus.BAD_REQUEST,
        );
      }
      patch.confidence = value;
      const label =
        step.options.find((o) => o.value === value)?.label ?? value;
      return `Confidence: ${label}`;
    }

    const barriers = [...new Set(values.filter((v) => barrierAllowed.has(v)))];
    if (!barriers.length) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'Pick at least one listed barrier',
        HttpStatus.BAD_REQUEST,
      );
    }
    patch[step.id] = barriers;
    if (values.includes('other') && selection.otherText?.trim()) {
      patch[`${step.id}Other`] = selection.otherText.trim();
    }
    const labelByValue = new Map(
      (step.secondaryOptions ?? []).map((o) => [o.value, o.label] as const),
    );
    return `Barriers: ${barriers
      .map((v) => labelByValue.get(v) ?? v)
      .join(', ')}`;
  }

  private applyPlainOptionsSelection(
    step: QuestionnaireStepDto,
    selection: IntakeChatSelectionDto,
    values: string[],
    patch: QuestionnaireAnswers,
  ): string {
    const allowed = new Set(allowedValuesForStep(step));
    const picked = values.filter((v) => allowed.has(v));
    if (!picked.length) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        `Invalid ${step.id} selection — pick a listed option`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (step.selection === 'multi') {
      patch[step.id] = picked;
    } else {
      patch[step.id] = picked[0]!;
    }
    if (picked.includes('other') && selection.otherText?.trim()) {
      patch[`${step.id}Other`] = selection.otherText.trim();
    }

    const labelByValue = new Map(
      step.options.map((o) => [o.value, o.label] as const),
    );
    return picked
      .map((v) =>
        v === 'other' && selection.otherText?.trim()
          ? selection.otherText.trim()
          : (labelByValue.get(v) ?? v),
      )
      .join(', ');
  }

  private skillLabel(step: QuestionnaireStepDto, slug: string): string {
    const fromStep = step.options.find((o) => o.value === slug)?.label;
    if (fromStep) return fromStep;
    for (const cached of this.skillSuggestCache.values()) {
      const hit = cached.options.find((o) => o.value === slug);
      if (hit) return hit.label;
    }
    return humanizeSkillSlug(slug);
  }

  // ---------------------------------------------------------------- turns

  private async runTurn(
    userId: string,
    userMessage: string | null,
    opts: {
      isStart: boolean;
      skipLlm: boolean;
      preAnswers?: QuestionnaireAnswers;
      preMeta?: IntakeChatMeta;
    },
  ): Promise<ChatTurnResponse> {
    const { isStart, skipLlm, preAnswers, preMeta } = opts;
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

    const meta = preMeta ?? this.readMeta(row.answers);
    const priorAnswers = normalizeDraftAnswers(
      preAnswers ?? row.answers ?? {},
      schema,
    );
    const pendingBefore = this.chatPending(priorAnswers, meta);
    const transcript = [...(row.chatTranscript ?? [])];
    if (userMessage) {
      transcript.push({ role: 'user', content: userMessage });
    }

    // Chip/start/done — ask from suggestion title, zero LLM tokens.
    if (skipLlm || (!isStart && pendingBefore.length === 0)) {
      const focus = await this.suggestionsFor(userId, priorAnswers, meta);
      const assistantTurnIndex = transcript.filter(
        (m) => m.role === 'assistant',
      ).length;
      const assistantMessage = buildDeterministicAssistantMessage(
        focus?.title ?? null,
        { isStart, assistantTurnIndex },
      );
      const done = pendingBefore.length === 0;
      transcript.push({ role: 'assistant', content: assistantMessage });
      row.answers = this.withMeta(priorAnswers, meta);
      row.schemaVersion = schema.schemaVersion;
      row.chatTranscript = transcript;
      if (row.status !== QuestionnaireResponseStatus.Submitted) {
        row.status = QuestionnaireResponseStatus.Draft;
      }
      await this.responsesRepo.save(row);
      return {
        assistantMessage,
        answers: priorAnswers,
        transcript,
        missingFields: pendingBefore,
        done,
        promptVersion: INTAKE_CHAT_PROMPT_VERSION,
        model: null,
        suggestions: done ? null : focus,
      };
    }

    const clientConfigured = this.llm.isConfigured();
    let model = await this.llm.getModel('intake');
    const provider = findProviderForModel(model);
    this.logger.log(
      `[intake-llm] start user=${userId} model=${model} provider=${provider?.id ?? 'unknown'} base=${provider?.baseURL ?? '?'} configured=${clientConfigured}`,
    );

    const focus = await this.suggestionsFor(userId, priorAnswers, meta);

    if (!clientConfigured) {
      const fallback =
        'LLM is not configured. Switch to form intake, or set CEREBRAS_API_KEY / provider API key.';
      transcript.push({ role: 'assistant', content: fallback });
      row.chatTranscript = transcript;
      row.answers = this.withMeta(priorAnswers, meta);
      await this.responsesRepo.save(row);
      return {
        assistantMessage: fallback,
        answers: priorAnswers,
        transcript,
        missingFields: pendingBefore,
        done: false,
        promptVersion: INTAKE_CHAT_PROMPT_VERSION,
        model: null,
        suggestions: focus,
      };
    }

    const system = buildIntakeChatSystemPrompt(focus);
    const user = buildIntakeChatUserPrompt({
      transcript,
      partialAnswers: priorAnswers,
      missingFields: pendingBefore,
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
      const partial = this.mergeLlmSkillPartial(
        parsed.partialAnswers ?? {},
        priorAnswers,
        focus,
      );
      const mergedRaw = { ...priorAnswers, ...partial };
      const answers = normalizeDraftAnswers(mergedRaw, schema);
      const nextMeta = this.metaAfterLlm(meta, partial, focus);
      const missing = this.chatPending(answers, nextMeta);
      const assistantMessage = parsed.assistantMessage.trim().slice(0, 200);

      transcript.push({ role: 'assistant', content: assistantMessage });
      row.answers = this.withMeta(answers, nextMeta);
      row.schemaVersion = schema.schemaVersion;
      row.chatTranscript = transcript;
      if (row.status !== QuestionnaireResponseStatus.Submitted) {
        row.status = QuestionnaireResponseStatus.Draft;
      }
      await this.responsesRepo.save(row);

      const done = missing.length === 0 && parsed.done;
      return {
        assistantMessage,
        answers,
        transcript,
        missingFields: missing,
        done,
        promptVersion: INTAKE_CHAT_PROMPT_VERSION,
        model,
        suggestions:
          missing.length === 0
            ? null
            : await this.suggestionsFor(userId, answers, nextMeta),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[intake-llm] soft-fail model=${model} provider=${findProviderForModel(model)?.id ?? '?'}: ${message}`,
      );
      const fallback = this.userFacingLlmError(message, model);
      transcript.push({ role: 'assistant', content: fallback });
      row.answers = this.withMeta(priorAnswers, meta);
      row.chatTranscript = transcript;
      await this.responsesRepo.save(row);
      return {
        assistantMessage: fallback,
        answers: priorAnswers,
        transcript,
        missingFields: pendingBefore,
        done: false,
        promptVersion: INTAKE_CHAT_PROMPT_VERSION,
        model,
        suggestions: focus,
      };
    }
  }

  /**
   * When the LLM answers an exposure sub-question with a partial `skills`
   * array, merge into the prior entries by slug instead of replacing the
   * whole list (protects already-selected skills).
   */
  private mergeLlmSkillPartial(
    partial: Record<string, unknown>,
    prior: QuestionnaireAnswers,
    focus: IntakeSuggestions | null,
  ): Record<string, unknown> {
    if (
      focus?.fieldId !== 'skills' ||
      focus.subField !== 'exposure' ||
      !Array.isArray(partial.skills)
    ) {
      return partial;
    }
    const bySlug = new Map(
      asSkillEvidence(prior, 'skills').map((e) => [e.skillSlug, { ...e }]),
    );
    for (const item of partial.skills) {
      if (!isSkillEvidenceAnswer(item)) continue;
      const slug = item.skillSlug.trim();
      if (!slug) continue;
      bySlug.set(slug, { skillSlug: slug, exposureLevel: item.exposureLevel });
    }
    return { ...partial, skills: [...bySlug.values()] };
  }

  /** Update chat progress markers after an LLM-extracted partial answer. */
  private metaAfterLlm(
    meta: IntakeChatMeta,
    partial: Record<string, unknown>,
    focus: IntakeSuggestions | null,
  ): IntakeChatMeta {
    const next: IntakeChatMeta = {
      ...meta,
      exposureDone: [...(meta.exposureDone ?? [])],
    };
    if ('skills' in partial) {
      next.skillsAnswered = true;
      if (
        focus?.fieldId === 'skills' &&
        focus.subField === 'exposure' &&
        focus.skillSlug &&
        !next.exposureDone!.includes(focus.skillSlug)
      ) {
        next.exposureDone!.push(focus.skillSlug);
      }
    }
    if ('preferredSessionMinutes' in partial) {
      next.sessionAnswered = true;
    }
    return next;
  }

  // ----------------------------------------------------------- suggestions

  private async suggestionsFor(
    userId: string,
    answers: QuestionnaireAnswers,
    meta: IntakeChatMeta,
  ): Promise<IntakeSuggestions | null> {
    const schema = this.schemaService.getSchema();
    const base = buildIntakeSuggestions(schema, answers, meta);
    if (!base) return null;

    const step = schema.steps.find((s) => s.id === base.fieldId);

    if (step?.uiKind === 'track-select') {
      const roles = await this.listActiveRoleOptions();
      if (roles.length) {
        // Chips = unit-pool domains only (Frontend, ...). No career/schema roles.
        return {
          ...base,
          allowOther: false,
          options: roles.filter((o) => o.value !== 'other'),
        };
      }
      return base;
    }

    // Skill pick phase only — exposure phase already carries its own chips.
    if (step?.uiKind === 'skill-evidence' && !base.subField) {
      return this.aiSkillSuggestions(userId, base, answers);
    }

    return base;
  }

  /** Primary-track-keyed skill chips — deterministic pools (no LLM). */
  private async aiSkillSuggestions(
    userId: string,
    base: IntakeSuggestions,
    answers: QuestionnaireAnswers,
  ): Promise<IntakeSuggestions> {
    void userId;
    const track = asTrackSelection(answers, 'goal');
    const primary =
      track.primary || asString(answers, 'goalOther').trim();
    const sentinels: IntakeSuggestionOption[] = [
      { value: 'none', label: 'None of the above' },
      ...(base.allowOther ? [{ value: 'other', label: 'Other' }] : []),
    ];

    if (!primary) {
      return { ...base, options: sentinels };
    }

    const cached = this.skillSuggestCache.get(primary);
    if (
      cached &&
      Date.now() - cached.at < IntakeChatService.SKILL_SUGGEST_TTL_MS
    ) {
      return { ...base, options: [...cached.options, ...sentinels] };
    }

    const options = this.fallbackSkillSuggestions(primary).slice(0, 8);
    this.skillSuggestCache.set(primary, { at: Date.now(), options });
    return { ...base, options: [...options, ...sentinels] };
  }

  /** Primary domain → 8 skill chips. No LLM — covers seed domains + soft fallback. */
  private fallbackSkillSuggestions(primary: string): IntakeSuggestionOption[] {
    const g = primary.toLowerCase();
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

  /** Track chips = distinct domains from the active units pool. */
  private async listActiveRoleOptions(): Promise<
    Array<{ value: string; label: string }>
  > {
    try {
      return await this.unitsCatalog.listActiveDomains();
    } catch (err) {
      this.logger.warn(
        `Unit domain lookup failed: ${err instanceof Error ? err.message : err}`,
      );
      return [];
    }
  }

  // ------------------------------------------------------------------ llm

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
