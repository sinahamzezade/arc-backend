import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../common/llm/llm.service';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import {
  isQuizContent,
  isReadingContent,
  isTaskContent,
  stripPlaySecrets,
  type UnitPlayContent,
} from './lesson-play.types';
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
    content: UnitPlayContent;
    message: string;
    coachTone?: string;
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
    input: {
      userId: string;
      lesson: Lesson;
      content: UnitPlayContent;
      coachTone?: string;
    },
    message: string,
  ): Promise<string | null> {
    if (!this.llm.isConfigured()) return null;

    const model = await this.llm.getModel('arlo');
    const contentSummary = this.summarizeContent(input.content);
    const toneLine = input.coachTone
      ? this.toneConstraintLine(input.coachTone)
      : 'Tone: steady and supportive — clear, calm coaching.';

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
              toneLine,
              `Lesson title: ${input.lesson.title}`,
              `Objective: ${input.content.objective}`,
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

  private toneConstraintLine(tone: string): string {
    switch (tone) {
      case 'welcome_back':
        return 'Tone: warm welcome-back — acknowledge their return without guilt.';
      case 'playful':
        return 'Tone: playful and celebratory — light humor, momentum-focused.';
      case 'encouraging':
        return 'Tone: encouraging — normalize struggle, suggest a smaller next step.';
      default:
        return 'Tone: steady and supportive — clear, calm coaching.';
    }
  }

  /** Type-specific summary — secrets (quiz answers/explanations) stripped. */
  private summarizeContent(content: UnitPlayContent): string {
    const safe = stripPlaySecrets(content);
    if (isReadingContent(safe)) {
      const sections = safe.sections.slice(0, 4).map((s, i) => {
        if (typeof s === 'string') {
          return `Section ${i + 1}: ${s.slice(0, 240)}`;
        }
        const title = s.title?.trim() || `Section ${i + 1}`;
        const body = (s.blocks ?? [])
          .map((b) => b.body || b.code || b.title || '')
          .filter(Boolean)
          .join(' ')
          .slice(0, 240);
        return `${title}: ${body}`;
      });
      const takeaways = safe.keyTakeaways.length
        ? `Key takeaways: ${safe.keyTakeaways.join('; ').slice(0, 400)}`
        : '';
      return [...sections, takeaways].filter(Boolean).join('\n');
    }
    if (isTaskContent(safe)) {
      return [
        `Task: ${safe.task.slice(0, 400)}`,
        safe.acceptanceCriteria.length
          ? `Acceptance criteria: ${safe.acceptanceCriteria.join('; ').slice(0, 400)}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');
    }
    if (isQuizContent(safe)) {
      return safe.questions
        .slice(0, 6)
        .map((q, i) => `Q${i + 1}: ${q.q.slice(0, 200)}`)
        .join('\n');
    }
    return 'note' in safe && typeof safe.note === 'string'
      ? `Video note: ${safe.note.slice(0, 400)}`
      : '';
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
