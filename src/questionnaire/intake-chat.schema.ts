import { z } from 'zod';

export const IntakeChatLlmResponseSchema = z.object({
  assistantMessage: z.string().min(1).max(2000),
  partialAnswers: z.record(z.unknown()).default({}),
  done: z.boolean().default(false),
});

export type IntakeChatLlmResponse = z.infer<typeof IntakeChatLlmResponseSchema>;

export function parseIntakeChatLlmResponse(
  raw: unknown,
): IntakeChatLlmResponse {
  return IntakeChatLlmResponseSchema.parse(raw);
}
