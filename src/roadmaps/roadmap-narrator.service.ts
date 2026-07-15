import { Injectable, Logger } from '@nestjs/common';
import { findProviderForModel } from '../common/llm/llm.providers';
import { LlmService } from '../common/llm/llm.service';
import {
  buildRoadmapNarratorSystemPrompt,
  buildRoadmapNarratorUserPrompt,
  ROADMAP_NARRATOR_PROMPT_VERSION,
  type NarratorDraft,
  type NarratorLearner,
  type NarratorLesson,
} from './roadmap-narrator.prompt';
import { parseRoadmapNarratorDraft } from './roadmap-narrator.schema';

export type NarrationResult = {
  draft: NarratorDraft;
  model: string;
  promptVersion: string;
  /** true when LLM output was rejected and deterministic slicing was used. */
  repaired: boolean;
};

/**
 * Wraps the narrator LLM call. Selection/order are decided upstream — this
 * only asks for grouping + copy, validates the invariants (contiguous slices,
 * every index exactly once, 3-6 phases) and falls back to deterministic even
 * slicing when the LLM output violates them or the call fails.
 */
@Injectable()
export class RoadmapNarratorService {
  private readonly logger = new Logger(RoadmapNarratorService.name);

  constructor(private readonly llm: LlmService) {}

  getPromptVersion(): string {
    return ROADMAP_NARRATOR_PROMPT_VERSION;
  }

  async narrate(input: {
    userId: string;
    learner: NarratorLearner;
    lessons: NarratorLesson[];
  }): Promise<NarrationResult> {
    const llmResult = await this.callLlm(input);
    if (llmResult) {
      return {
        draft: llmResult.draft,
        model: llmResult.model,
        promptVersion: ROADMAP_NARRATOR_PROMPT_VERSION,
        repaired: false,
      };
    }

    this.logger.warn(
      `content_narration_repaired user=${input.userId} lessons=${input.lessons.length} — deterministic even slicing`,
    );
    return {
      draft: this.evenSlicingDraft(input.learner, input.lessons),
      model: 'deterministic-slicing',
      promptVersion: ROADMAP_NARRATOR_PROMPT_VERSION,
      repaired: true,
    };
  }

  private async callLlm(input: {
    userId: string;
    learner: NarratorLearner;
    lessons: NarratorLesson[];
  }): Promise<{ draft: NarratorDraft; model: string } | null> {
    if (!this.llm.isConfigured()) {
      this.logger.warn(`[roadmap-narrator] skipped — no API key configured`);
      return null;
    }
    if (!input.lessons.length) {
      this.logger.warn(`[roadmap-narrator] skipped — empty lesson list`);
      return null;
    }

    const model = await this.llm.getModel('enrich');
    const provider = findProviderForModel(model);
    this.logger.log(
      `[roadmap-narrator] chat start model=${model} provider=${provider?.id ?? 'unknown'} lessons=${input.lessons.length}`,
    );

    const system = buildRoadmapNarratorSystemPrompt();
    const baseUser = buildRoadmapNarratorUserPrompt(
      input.learner,
      input.lessons,
    );
    const attempts: Array<{ user: string; temperature: number }> = [
      { user: baseUser, temperature: 0.5 },
      {
        user: `${baseUser}\nREDO: your previous grouping broke the rules. Phases MUST be contiguous slices covering every index 0..${input.lessons.length - 1} exactly once, in order, split into 3-6 phases.`,
        temperature: 0.3,
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
            max_tokens: 1200,
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
          `[roadmap-narrator] attempt ${i + 1} response ms=${ms} chars=${content?.length ?? 0}`,
        );
        if (!content) continue;

        const draft = parseRoadmapNarratorDraft(
          JSON.parse(content),
          input.lessons.length,
        );
        const returnedModel =
          typeof completion.model === 'string' && completion.model
            ? completion.model
            : model;
        this.logger.log(
          `[roadmap-narrator] accepted phases=${draft.phases.length} attempt=${i + 1} model=${returnedModel}`,
        );
        return { draft, model: returnedModel };
      } catch (err) {
        this.logger.warn(
          `[roadmap-narrator] attempt ${i + 1} FAILED ms=${Date.now() - t0}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return null;
  }

  /**
   * Deterministic repair: split ordered lessons into 3-6 contiguous even
   * slices, preferring phase boundaries on skill changes when nearby.
   */
  evenSlicingDraft(
    learner: NarratorLearner,
    lessons: NarratorLesson[],
  ): NarratorDraft {
    const n = lessons.length;
    const phaseCount = Math.max(1, Math.min(6, Math.min(n, n <= 5 ? 3 : 4)));
    const base = Math.floor(n / phaseCount);
    const extra = n % phaseCount;

    const boundaries: number[] = [];
    let cursor = 0;
    for (let p = 0; p < phaseCount; p++) {
      cursor += base + (p < extra ? 1 : 0);
      boundaries.push(cursor);
    }

    // Nudge boundaries to the nearest skill change within ±2 for cleaner cuts.
    for (let b = 0; b < boundaries.length - 1; b++) {
      const target = boundaries[b]!;
      for (const delta of [0, 1, -1, 2, -2]) {
        const idx = target + delta;
        if (idx <= (b > 0 ? boundaries[b - 1]! : 0)) continue;
        if (idx >= n) continue;
        if (b + 1 < boundaries.length && idx >= boundaries[b + 1]!) continue;
        if (lessons[idx]!.skill !== lessons[idx - 1]!.skill) {
          boundaries[b] = idx;
          break;
        }
      }
    }

    const phases: NarratorDraft['phases'] = [];
    let start = 0;
    for (let p = 0; p < boundaries.length; p++) {
      const end = boundaries[p]!;
      if (end <= start) continue;
      const slice = lessons.slice(start, end);
      const firstSkill = slice[0]?.skill ?? 'core';
      const lastSkill = slice[slice.length - 1]?.skill ?? firstSkill;
      const label =
        firstSkill === lastSkill ? firstSkill : `${firstSkill} to ${lastSkill}`;
      phases.push({
        key: `stage-${phases.length + 1}`,
        title: `Unlock ${label}`.slice(0, 80),
        lessonIndices: slice.map((l) => l.i),
      });
      start = end;
    }

    return {
      title: `${learner.goal} Roadmap`.slice(0, 120),
      description: `A step-by-step path to ${learner.goal}, ordered so every lesson builds on the last.`,
      why: `Fundamentals come first so each phase unlocks the next on the way to ${learner.goal}.`,
      phases,
    };
  }
}
