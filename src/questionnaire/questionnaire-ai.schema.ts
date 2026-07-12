import { z } from 'zod';
import type { QuestionnaireSchemaDto } from './schema/schema.types';

const optionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1).max(160),
});

export const questionnaireAiCopySchema = z.object({
  steps: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1).max(200),
        subtitle: z.string().min(1).max(300),
        reviewLabel: z.string().min(1).max(80),
        options: z.array(optionSchema).optional(),
        scheduleTimes: z.array(optionSchema).optional(),
      }),
    )
    .min(1),
});

export type QuestionnaireAiCopy = z.infer<typeof questionnaireAiCopySchema>;

/**
 * Validate AI copy against Zod + base schema allow-lists (ids/values frozen).
 */
export function parseAndAssertQuestionnaireAiCopy(
  raw: unknown,
  base: QuestionnaireSchemaDto,
): QuestionnaireAiCopy {
  const parsed = questionnaireAiCopySchema.parse(raw);
  const baseById = new Map(base.steps.map((s) => [s.id, s]));

  if (parsed.steps.length !== base.steps.length) {
    throw new Error(
      `AI copy step count ${parsed.steps.length} !== base ${base.steps.length}`,
    );
  }

  const seen = new Set<string>();
  for (const step of parsed.steps) {
    if (seen.has(step.id)) {
      throw new Error(`Duplicate AI step id: ${step.id}`);
    }
    seen.add(step.id);

    const baseStep = baseById.get(step.id);
    if (!baseStep) {
      throw new Error(`Unknown AI step id: ${step.id}`);
    }

    const baseOptValues = new Set(baseStep.options.map((o) => o.value));
    const aiOpts = step.options ?? [];
    if (baseOptValues.size > 0) {
      if (aiOpts.length !== baseStep.options.length) {
        throw new Error(
          `AI options length for ${step.id}: ${aiOpts.length} !== ${baseStep.options.length}`,
        );
      }
      for (const opt of aiOpts) {
        if (!baseOptValues.has(opt.value)) {
          throw new Error(
            `Unknown option value for ${step.id}: ${opt.value}`,
          );
        }
      }
    } else if (aiOpts.length > 0) {
      throw new Error(`AI sent options for optionless step ${step.id}`);
    }

    const baseTimes = baseStep.scheduleTimes ?? [];
    const baseTimeValues = new Set(baseTimes.map((t) => t.value));
    const aiTimes = step.scheduleTimes ?? [];
    if (baseTimes.length > 0) {
      if (aiTimes.length !== baseTimes.length) {
        throw new Error(
          `AI scheduleTimes length for ${step.id}: ${aiTimes.length} !== ${baseTimes.length}`,
        );
      }
      for (const t of aiTimes) {
        if (!baseTimeValues.has(t.value)) {
          throw new Error(
            `Unknown scheduleTime value for ${step.id}: ${t.value}`,
          );
        }
      }
    } else if (aiTimes.length > 0) {
      throw new Error(`AI sent scheduleTimes for non-schedule step ${step.id}`);
    }
  }

  for (const baseStep of base.steps) {
    if (!seen.has(baseStep.id)) {
      throw new Error(`Missing AI step id: ${baseStep.id}`);
    }
  }

  return parsed;
}
