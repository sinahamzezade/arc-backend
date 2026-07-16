import { z } from 'zod';

export const RoadmapCompletionCoachResponseSchema = z.object({
  recommendation: z.enum(['new_goal', 'same_goal_advanced', 'top_up']),
  rationale: z.string().min(1).max(400),
});

export type RoadmapCompletionCoachResponse = z.infer<
  typeof RoadmapCompletionCoachResponseSchema
>;

export function parseRoadmapCompletionCoachResponse(raw: unknown) {
  return RoadmapCompletionCoachResponseSchema.parse(raw);
}
