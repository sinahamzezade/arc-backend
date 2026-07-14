import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmService } from '../common/llm/llm.service';
import {
  buildQuestionnaireAiSystemPrompt,
  buildQuestionnaireAiUserPrompt,
  QUESTIONNAIRE_AI_PROMPT_VERSION,
} from './questionnaire-ai.prompt';
import {
  parseAndAssertQuestionnaireAiCopy,
  type QuestionnaireAiCopy,
} from './questionnaire-ai.schema';
import type { QuestionnaireSchemaDto } from './schema/schema.types';
import { SystemFlagsService } from '../system-flags/system-flags.service';
import { SystemFlagKey } from '../system-flags/system-flag.keys';

@Injectable()
export class QuestionnaireAiService {
  private readonly logger = new Logger(QuestionnaireAiService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly llm: LlmService,
    private readonly systemFlags: SystemFlagsService,
  ) {}

  async isEnabled(): Promise<boolean> {
    if (
      !(await this.systemFlags.getBool(
        SystemFlagKey.QUESTIONNAIRE_AI_ENABLED,
        true,
      ))
    ) {
      return false;
    }
    return this.llm.isConfigured();
  }

  async getModel(): Promise<string> {
    return this.llm.getModel('questionnaire_copy');
  }

  getPromptVersion(): string {
    return (
      this.config.get<string>('QUESTIONNAIRE_AI_PROMPT_VERSION')?.trim() ||
      QUESTIONNAIRE_AI_PROMPT_VERSION
    );
  }

  /**
   * Generate question copy via LLM. Soft-fail → null.
   * Ids / option values stay frozen from base schema.
   */
  async generateCopy(
    base: QuestionnaireSchemaDto,
  ): Promise<QuestionnaireAiCopy | null> {
    if (!base.steps.length || !(await this.isEnabled())) {
      return null;
    }

    const client = this.llm.createClient();
    if (!client) {
      return null;
    }

    const model = await this.getModel();
    const promptVersion = this.getPromptVersion();

    try {
      const completion = await client.chat.completions.create({
        model,
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildQuestionnaireAiSystemPrompt() },
          { role: 'user', content: buildQuestionnaireAiUserPrompt(base) },
        ],
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        this.logger.warn('Questionnaire AI empty response — soft-fail');
        return null;
      }

      const raw: unknown = JSON.parse(content);
      const copy = parseAndAssertQuestionnaireAiCopy(raw, base);
      this.logger.log(
        `Questionnaire AI copy generated model=${model} prompt=${promptVersion}`,
      );
      return copy;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Questionnaire AI soft-fail: ${message}`);
      return null;
    }
  }

  applyCopy(
    base: QuestionnaireSchemaDto,
    copy: QuestionnaireAiCopy,
  ): QuestionnaireSchemaDto {
    const byId = new Map(copy.steps.map((s) => [s.id, s]));

    return {
      ...base,
      steps: base.steps.map((step) => {
        const ai = byId.get(step.id);
        if (!ai) return step;

        const labelByValue = new Map(
          (ai.options ?? []).map((o) => [o.value, o.label]),
        );
        const timeLabelByValue = new Map(
          (ai.scheduleTimes ?? []).map((t) => [t.value, t.label]),
        );

        return {
          ...step,
          title: ai.title,
          subtitle: ai.subtitle,
          reviewLabel: ai.reviewLabel,
          options: step.options.map((opt) => ({
            ...opt,
            label: labelByValue.get(opt.value) ?? opt.label,
          })),
          ...(step.scheduleTimes?.length
            ? {
                scheduleTimes: step.scheduleTimes.map((t) => ({
                  ...t,
                  label: timeLabelByValue.get(t.value) ?? t.label,
                })),
              }
            : {}),
        };
      }),
    };
  }
}
