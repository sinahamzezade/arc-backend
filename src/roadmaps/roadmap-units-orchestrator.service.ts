import { Injectable, Logger } from '@nestjs/common';
import { findProviderForModel } from '../common/llm/llm.providers';
import { LlmService } from '../common/llm/llm.service';
import type { Unit } from '../content-pool/entities/unit.entity';
import {
  buildUnitsOrchestratorSystemPrompt,
  buildUnitsOrchestratorUserPrompt,
  ROADMAP_UNITS_ORCHESTRATOR_PROMPT_VERSION,
  type OrchestratorCatalogUnit,
  type OrchestratorDraft,
  type OrchestratorLearnerPacket,
} from './roadmap-units-orchestrator.prompt';
import { parseUnitsOrchestratorDraft } from './roadmap-units-orchestrator.schema';
import {
  validateAndRepairOrchestratorDraft,
  type SkillAction,
  type ValidateRepairResult,
} from './roadmap-units-orchestrator.validate';

export type OrchestrationResult = {
  draft: OrchestratorDraft;
  unitIds: string[];
  model: string;
  promptVersion: string;
  /** true when server repaired the LLM draft (still used). */
  repaired: boolean;
  repairReasons: string[];
};

export type OrchestratorRequest = {
  userId: string;
  learner: OrchestratorLearnerPacket;
  allowList: Unit[];
  requiredGap: Set<string>;
  optionalGap: Set<string>;
  orderedGapSkillIds: string[];
  skillPlans: Map<string, { action: SkillAction; entryStage: number }>;
  skillTitleById: Map<string, string>;
  budgetMinutes: number;
  recipeTitle: string;
  roleSlug: string;
};

/**
 * AI propose + server validate for units-pool roadmaps.
 * On LLM failure returns null so the pipeline can fall back to deterministic
 * select+pack+narrator.
 */
@Injectable()
export class RoadmapUnitsOrchestratorService {
  private readonly logger = new Logger(RoadmapUnitsOrchestratorService.name);

  constructor(private readonly llm: LlmService) {}

  getPromptVersion(): string {
    return ROADMAP_UNITS_ORCHESTRATOR_PROMPT_VERSION;
  }

  /**
   * Propose ordered units from allow-list. Returns null when LLM unavailable
   * or output cannot be repaired into a valid covering plan.
   */
  async orchestrate(
    input: OrchestratorRequest,
  ): Promise<OrchestrationResult | null> {
    if (!input.allowList.length) {
      this.logger.warn(`[units-orchestrator] skipped — empty allow-list`);
      return null;
    }

    const llmDraft = await this.callLlm(input);
    if (!llmDraft) return null;

    const allowMap = new Map(input.allowList.map((u) => [u.id, u]));
    try {
      const repaired = validateAndRepairOrchestratorDraft({
        draft: llmDraft.draft,
        allowList: allowMap,
        requiredGap: input.requiredGap,
        optionalGap: input.optionalGap,
        orderedGapSkillIds: input.orderedGapSkillIds,
        skillPlans: input.skillPlans,
        budgetMinutes: input.budgetMinutes,
        skillTitleById: input.skillTitleById,
      });

      this.logAnalytics(input.userId, repaired);

      return {
        draft: repaired.draft,
        unitIds: repaired.unitIds,
        model: llmDraft.model,
        promptVersion: ROADMAP_UNITS_ORCHESTRATOR_PROMPT_VERSION,
        repaired: repaired.repaired,
        repairReasons: repaired.repairReasons,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `content_orchestration_fallback user=${input.userId} reason=repair_failed detail=${msg}`,
      );
      return null;
    }
  }

  /** Expose validate for tests / pipeline direct repair. */
  validateAndRepair(
    input: Parameters<typeof validateAndRepairOrchestratorDraft>[0],
  ): ValidateRepairResult {
    return validateAndRepairOrchestratorDraft(input);
  }

  private logAnalytics(userId: string, result: ValidateRepairResult): void {
    if (result.repaired) {
      this.logger.log(
        `content_orchestration_repaired user=${userId} units=${result.unitIds.length} reasons=${result.repairReasons.slice(0, 8).join('|')}`,
      );
    } else {
      this.logger.log(
        `content_orchestration_applied user=${userId} units=${result.unitIds.length}`,
      );
    }
  }

  private async callLlm(
    input: OrchestratorRequest,
  ): Promise<{ draft: OrchestratorDraft; model: string } | null> {
    if (!this.llm.isConfigured()) {
      this.logger.warn(`[units-orchestrator] skipped — no API key configured`);
      return null;
    }

    const model = await this.llm.getModel('enrich');
    const provider = findProviderForModel(model);
    const catalog = this.toCatalog(input.allowList);
    const unitIdByIndex = new Map(catalog.map((c) => [c.n, c.id]));
    const allowIds = new Set(input.allowList.map((u) => u.id));

    this.logger.log(
      `[units-orchestrator] chat start model=${model} provider=${provider?.id ?? 'unknown'} allow=${catalog.length} required=${input.requiredGap.size}`,
    );

    const system = buildUnitsOrchestratorSystemPrompt();
    const baseUser = buildUnitsOrchestratorUserPrompt({
      learner: input.learner,
      units: catalog,
      recipeTitle: input.recipeTitle,
      roleSlug: input.roleSlug,
    });
    const attempts: Array<{ user: string; temperature: number }> = [
      { user: baseUser, temperature: 0.4 },
      {
        user: `${baseUser}\nREDO: previous plan broke rules. Use ONLY cat.units indices. Cover EVERY u.required skill. Fit u.budget minutes. 3-6 phases.`,
        temperature: 0.2,
      },
    ];

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i]!;
      const t0 = Date.now();
      try {
        const completion = await this.llm.chatCompletion({
          purpose: 'enrich',
          userId: input.userId,
          request: {
            model,
            temperature: attempt.temperature,
            max_tokens: 2500,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: attempt.user },
            ],
          },
        });
        const ms = Date.now() - t0;
        const content = completion.choices[0]?.message?.content;
        this.logger.log(
          `[units-orchestrator] attempt ${i + 1} response ms=${ms} chars=${content?.length ?? 0}`,
        );
        if (!content) continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(content);
        } catch {
          this.logger.warn(
            `[units-orchestrator] attempt ${i + 1} JSON parse failed`,
          );
          continue;
        }

        try {
          const draft = parseUnitsOrchestratorDraft(
            parsed,
            unitIdByIndex,
            allowIds,
          );
          return { draft, model };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `[units-orchestrator] attempt ${i + 1} schema reject: ${msg}`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[units-orchestrator] attempt ${i + 1} LLM error: ${msg}`,
        );
      }
    }

    this.logger.warn(
      `content_orchestration_fallback user=${input.userId} reason=llm_failed`,
    );
    return null;
  }

  private toCatalog(units: Unit[]): OrchestratorCatalogUnit[] {
    // Cap catalog size for token budget — prefer shorter + required-leaning.
    const capped = [...units]
      .sort(
        (a, b) =>
          a.estimatedMinutes - b.estimatedMinutes || a.id.localeCompare(b.id),
      )
      .slice(0, 120);

    return capped.map((u, n) => ({
      n,
      id: u.id,
      t: u.title.slice(0, 80),
      m: u.estimatedMinutes,
      lt: u.lessonType,
      role: u.unitRole ?? 'core',
      sk: u.skillsTaught ?? [],
      lvl: u.level,
      req: false,
    }));
  }
}
