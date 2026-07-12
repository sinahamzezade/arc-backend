import { z } from 'zod';

/** AI enrich payload — ids must already exist in the deterministic plan / allow-lists. */
export const roadmapAiEnrichSchema = z.object({
  pathTitle: z.string().min(1).max(120).optional(),
  phases: z
    .array(
      z.object({
        key: z.string().min(1),
        title: z.string().min(1).max(120).optional(),
        milestoneOrder: z.array(z.string().uuid()).optional(),
        milestones: z
          .array(
            z.object({
              skillNodeId: z.string().uuid(),
              title: z.string().min(1).max(120).optional(),
              lessonOrder: z.array(z.string().uuid()).optional(),
              lessons: z
                .array(
                  z.object({
                    lessonTemplateId: z.string().uuid(),
                    title: z.string().min(1).max(160).optional(),
                    missionName: z.string().min(1).max(160).nullable().optional(),
                    resourceId: z.string().uuid().nullable().optional(),
                  }),
                )
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .min(1),
});

export type RoadmapAiEnrich = z.infer<typeof roadmapAiEnrichSchema>;

export type RoadmapAiAllowLists = {
  phaseKeys: Set<string>;
  skillNodeIds: Set<string>;
  lessonTemplateIds: Set<string>;
  resourceIds: Set<string>;
};

/**
 * Validate enrich against Zod + allow-lists (unknown ids rejected).
 * Returns parsed enrich or throws ZodError / Error with detail.
 */
export function parseAndAssertRoadmapAiEnrich(
  raw: unknown,
  allow: RoadmapAiAllowLists,
): RoadmapAiEnrich {
  const parsed = roadmapAiEnrichSchema.parse(raw);

  for (const phase of parsed.phases) {
    if (!allow.phaseKeys.has(phase.key)) {
      throw new Error(`Unknown phase key: ${phase.key}`);
    }
    for (const skillId of phase.milestoneOrder ?? []) {
      if (!allow.skillNodeIds.has(skillId)) {
        throw new Error(`Unknown skillNodeId in milestoneOrder: ${skillId}`);
      }
    }
    for (const milestone of phase.milestones ?? []) {
      if (!allow.skillNodeIds.has(milestone.skillNodeId)) {
        throw new Error(`Unknown skillNodeId: ${milestone.skillNodeId}`);
      }
      for (const templateId of milestone.lessonOrder ?? []) {
        if (!allow.lessonTemplateIds.has(templateId)) {
          throw new Error(`Unknown lessonTemplateId in lessonOrder: ${templateId}`);
        }
      }
      for (const lesson of milestone.lessons ?? []) {
        if (!allow.lessonTemplateIds.has(lesson.lessonTemplateId)) {
          throw new Error(
            `Unknown lessonTemplateId: ${lesson.lessonTemplateId}`,
          );
        }
        if (
          lesson.resourceId != null &&
          !allow.resourceIds.has(lesson.resourceId)
        ) {
          throw new Error(`Unknown resourceId: ${lesson.resourceId}`);
        }
      }
    }
  }

  return parsed;
}
