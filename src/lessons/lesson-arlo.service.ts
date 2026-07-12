import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import type { LessonPlayOutline } from './lesson-play.types';

@Injectable()
export class LessonArloService {
  private readonly logger = new Logger(LessonArloService.name);

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    if (this.config.get<string>('ARLO_AI_ENABLED') === 'false') {
      return false;
    }
    return Boolean(this.config.get<string>('OPENAI_API_KEY')?.trim());
  }

  async chat(input: {
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

    if (this.isEnabled()) {
      try {
        const reply = await this.generateAiReply(input, message);
        if (reply) return { reply, source: 'ai' };
      } catch (err) {
        this.logger.warn(
          `Arlo AI failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { reply: this.stubReply(message, input.lesson.title), source: 'stub' };
  }

  private async generateAiReply(
    input: { lesson: Lesson; outline: LessonPlayOutline },
    message: string,
  ): Promise<string | null> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) return null;

    const model =
      this.config.get<string>('OPENAI_ARLO_MODEL')?.trim() ||
      this.config.get<string>('OPENAI_ROADMAP_MODEL')?.trim() ||
      'gpt-4o-mini';

    const contentSummary = input.outline.content
      .slice(0, 4)
      .map((page) => {
        const texts = page.blocks
          .filter((b) => b.type === 'text' || b.type === 'callout')
          .map((b) => ('body' in b ? b.body : ''))
          .join(' ');
        return `${page.title}: ${texts.slice(0, 240)}`;
      })
      .join('\n');

    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
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
            `Lesson title: ${input.lesson.title}`,
            `Objective: ${input.outline.objective}`,
            `Teaching outline:\n${contentSummary}`,
          ].join('\n'),
        },
        { role: 'user', content: message },
      ],
    });

    const content = completion.choices[0]?.message?.content?.trim();
    return content || null;
  }

  private stubReply(input: string, lessonTitle: string): string {
    const q = input.toLowerCase();
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
