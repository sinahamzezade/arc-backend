import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../common/llm/llm.service';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import type { LessonPlayOutline } from './lesson-play.types';
import { SystemFlagsService } from '../system-flags/system-flags.service';
import { SystemFlagKey } from '../system-flags/system-flag.keys';

@Injectable()
export class LessonArloService {
  private readonly logger = new Logger(LessonArloService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly systemFlags: SystemFlagsService,
  ) {}

  async isEnabled(): Promise<boolean> {
    if (!(await this.isFlagEnabled())) {
      return false;
    }
    return this.llm.isConfigured();
  }

  /** Admin feature flag only (ignores LLM config). */
  async isFlagEnabled(userId?: string | null): Promise<boolean> {
    return this.systemFlags.getBool(
      SystemFlagKey.ARLO_AI_ENABLED,
      true,
      userId,
    );
  }

  async chat(input: {
    userId: string;
    lesson: Lesson;
    outline: LessonPlayOutline;
    message: string;
  }): Promise<{ reply: string; source: 'ai' | 'stub' }> {
    const message = input.message.trim().slice(0, 1000);
    if (!message) {
      return {
        reply: `Ask me anything about “${input.lesson.title}”.`,
        source: 'stub',
      };
    }

    if (await this.isEnabled()) {
      try {
        const reply = await this.generateAiReply(input, message);
        if (reply) return { reply, source: 'ai' };
        this.logger.warn('Arlo AI returned empty completion');
      } catch (err) {
        this.logger.warn(
          `Arlo AI failed (model=${await this.llm.getModel('arlo')}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    } else if (!this.llm.isConfigured()) {
      this.logger.warn('Arlo AI skipped — LLM_API_KEY / LLM_BASE_URL not set');
    }

    return { reply: this.stubReply(message, input.lesson.title), source: 'stub' };
  }

  private async generateAiReply(
    input: { userId: string; lesson: Lesson; outline: LessonPlayOutline },
    message: string,
  ): Promise<string | null> {
    if (!this.llm.isConfigured()) return null;

    const model = await this.llm.getModel('arlo');
    const contentSummary = this.summarizeOutline(input.outline);

    const completion = await this.llm.chatCompletion({
      purpose: 'arlo',
      userId: input.userId,
      request: {
        model,
        temperature: 0.6,
        max_tokens: 280,
        messages: [
          {
            role: 'system',
            content: [
              'You are Arlo, a friendly lesson coach in the Arc learning app.',
              'Stay scoped to this lesson only. Be concise (2-5 short sentences).',
              'Never reveal quiz or practice correct answers or option letters.',
              'If asked for answers, give a hint toward the concept instead.',
              'If asked for a recap, summarize the objective and key ideas in under 60 seconds of reading.',
              `Lesson title: ${input.lesson.title}`,
              `Objective: ${input.outline.objective}`,
              contentSummary
                ? `Teaching outline:\n${contentSummary}`
                : 'Teaching outline: (not available — coach from title + objective).',
            ].join('\n'),
          },
          { role: 'user', content: message },
        ],
      },
    });

    const content = completion.choices[0]?.message?.content?.trim();
    return content || null;
  }

  private summarizeOutline(outline: LessonPlayOutline): string {
    const pages = Array.isArray(outline.content) ? outline.content : [];
    return pages
      .slice(0, 4)
      .map((page) => {
        const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
        const texts = blocks
          .filter((b) => b.type === 'text' || b.type === 'callout')
          .map((b) => ('body' in b ? b.body : ''))
          .join(' ');
        return `${page?.title ?? 'Page'}: ${texts.slice(0, 240)}`;
      })
      .join('\n');
  }

  private stubReply(input: string, lessonTitle: string): string {
    const q = input.toLowerCase();
    if (q.includes('recap') || q.includes('summar')) {
      return `60-sec take: “${lessonTitle}” is the idea to lock in. Say the objective in your own words, then one tiny example — that’s the whole stop.`;
    }
    if (q.includes('explain') || q.includes('what')) {
      return `In one line: this stop is about “${lessonTitle}”. Say it back, then practice.`;
    }
    if (q.includes('hint') || q.includes('stuck')) {
      return `Break “${lessonTitle}” into: what it is → why it matters → one tiny example.`;
    }
    if (q.includes('quiz') || q.includes('practice')) {
      return 'Do practice first, then quiz. Wrong answers teach faster than perfect reading.';
    }
    return `Solid question. Keep it tied to “${lessonTitle}” — ask for a recap, a hint, or a mini quiz.`;
  }
}
