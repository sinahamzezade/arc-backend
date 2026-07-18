import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmService } from '../common/llm/llm.service';
import { DEFAULT_LLM_MODEL } from '../common/llm/llm.providers';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import {
  isActiveFormatContent,
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
    private readonly config: ConfigService,
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

  /** Master Arlo flag + per-lesson-type allowlist. */
  async isEnabledForLessonType(
    lessonType: string,
    userId?: string | null,
  ): Promise<boolean> {
    return this.systemFlags.isArloEnabledForLessonType(lessonType, userId);
  }

  async chat(input: {
    userId: string;
    lesson: Lesson;
    content: UnitPlayContent;
    message: string;
    coachTone?: string;
  }): Promise<{ reply: string; source: 'ai' | 'stub' }> {
    const message = input.message.trim().slice(0, 1000);
    const models = await this.resolveArloModels();
    console.log('[Arlo chat] models=', models, {
      configured: this.llm.isConfigured(),
      enabled: await this.isEnabled(),
      lessonId: input.lesson.id,
      lessonTitle: input.lesson.title,
    });

    if (!message) {
      return {
        reply: `Ask me anything about “${input.lesson.title}”.`,
        source: 'stub',
      };
    }

    if (await this.isEnabled()) {
      try {
        const result = await this.generateAiReply(input, message, models);
        if (result) {
          console.log(
            '[Arlo chat] reply source=ai model=',
            result.model,
          );
          return { reply: result.reply, source: 'ai' };
        }
        this.logger.warn('Arlo AI returned empty completion on all models');
      } catch (err) {
        this.logger.warn(
          `Arlo AI failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    } else if (!this.llm.isConfigured()) {
      this.logger.warn('Arlo AI skipped — LLM_API_KEY / LLM_BASE_URL not set');
    }

    console.log('[Arlo chat] reply source=stub models=', models);
    return {
      reply: this.stubReply(message, input.lesson.title, input.content),
      source: 'stub',
    };
  }

  /** Primary admin/env model, then env override, then Cerebras default. */
  private async resolveArloModels(): Promise<string[]> {
    const primary = await this.llm.getModel('arlo');
    const envArlo =
      this.config.get<string>('LLM_ARLO_MODEL')?.trim() ||
      this.config.get<string>('OPENAI_ARLO_MODEL')?.trim() ||
      '';
    const fallbackRaw =
      this.config.get<string>('LLM_ARLO_FALLBACK_MODELS')?.trim() || '';
    const fallbacks = fallbackRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const list = [
      primary,
      envArlo,
      ...fallbacks,
      DEFAULT_LLM_MODEL,
      'gemma-4-31b',
      'llama-3.1-8b-instant',
    ].filter(Boolean);
    return [...new Set(list)];
  }

  private async generateAiReply(
    input: {
      userId: string;
      lesson: Lesson;
      content: UnitPlayContent;
      coachTone?: string;
    },
    message: string,
    models: string[],
  ): Promise<{ reply: string; model: string } | null> {
    if (!this.llm.isConfigured()) return null;

    const contentSummary = this.summarizeContent(input.content);
    const toneLine = input.coachTone
      ? this.toneConstraintLine(input.coachTone)
      : 'Tone: steady and supportive — clear, calm coaching.';

    const system = [
      'You are Arlo, a friendly lesson coach in the Arc learning app.',
      'Stay scoped to this lesson only. Be concise (2-5 short sentences).',
      '',
      'ANSWER THE QUESTION (critical):',
      '- Read the learner’s message carefully and answer THAT specific ask.',
      '- If they ask what a term/phrase/rule means (e.g. WCAG AA, contrast ratio), define it clearly using the lesson material.',
      '- Do NOT reply with a canned lesson intro, menu (“ask for a recap / hint”), or fixed template.',
      '- Do NOT ignore the question and restate the whole lesson objective.',
      '- Use the teaching outline below as source — quote/paraphrase the relevant part.',
      '',
      'LANGUAGE (critical):',
      '- Detect the learner’s language from their latest message.',
      '- Write your ENTIRE reply in that language (Farsi, Spanish, Arabic, French, German, etc.).',
      '- Translate concepts into that language. Do NOT mix languages or paste English source dumps.',
      '- Lesson titles may stay as proper names; explain them in the learner’s language.',
      '',
      'Never reveal quiz or practice correct answers or option letters.',
      'If asked for the graded answer, give a conceptual hint only — still answer their wording.',
      toneLine,
      '',
      'Source material (rewrite into the learner’s language; pick the part that answers them):',
      `Lesson title: ${input.lesson.title}`,
      `Objective: ${input.content.objective}`,
      contentSummary
        ? `Teaching outline:\n${contentSummary}`
        : 'Teaching outline: (not available — coach from title + objective).',
    ].join('\n');

    for (const model of models) {
      try {
        const completion = await this.llm.chatCompletion({
          purpose: 'arlo',
          userId: input.userId,
          request: {
            model,
            temperature: 0.5,
            max_tokens: 420,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: message },
            ],
          },
        });
        const reply = completion.choices[0]?.message?.content?.trim();
        if (reply) return { reply, model };
        this.logger.warn(`Arlo AI empty completion (model=${model})`);
      } catch (err) {
        this.logger.warn(
          `Arlo AI failed (model=${model}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return null;
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
    if (isActiveFormatContent(safe)) {
      return safe.blocks
        .slice(0, 8)
        .map((b) => {
          switch (b.type) {
            case 'text':
              return `Text: ${b.body.slice(0, 200)}`;
            case 'callout':
              return `Callout (${b.title}): ${b.body.slice(0, 200)}`;
            case 'scenario_decision':
              return `Scenario: ${b.setup.slice(0, 200)}`;
            case 'visual_hotspot': {
              const labels = b.hotspots
                .map((h) => h.label)
                .filter(Boolean)
                .slice(0, 6)
                .join(', ');
              return labels
                ? `Visual hotspot options: ${labels}`
                : 'Visual hotspot: tap the failing or correct target.';
            }
            case 'drag_order':
              return `Order task: ${b.items
                .map((i) => i.label)
                .slice(0, 6)
                .join(' → ')}`;
            case 'debate_pick':
              return `Debate: ${b.prompt.slice(0, 200)}`;
            case 'sandbox_simulation':
              return `Sandbox actions: ${b.actions.slice(0, 8).join(', ')}`;
            case 'live_context':
              return `Live context track: ${b.track_tag}`;
            default:
              return '';
          }
        })
        .filter(Boolean)
        .join('\n');
    }
    return 'note' in safe && typeof safe.note === 'string'
      ? `Video note: ${safe.note.slice(0, 400)}`
      : '';
  }

  /**
   * Temporary offline coach. Non-English replies never paste English
   * objective/outline — only localized coaching around the lesson title.
   */
  private stubReply(
    input: string,
    lessonTitle: string,
    content: UnitPlayContent,
  ): string {
    const lang = this.detectReplyLang(input);
    const objective =
      typeof content.objective === 'string' && content.objective.trim()
        ? content.objective.trim()
        : `get solid on “${lessonTitle}”`;
    const outline = this.summarizeContent(content);
    const firstBeat = outline
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0)
      ?.slice(0, 180);

    if (lang === 'fa') {
      return this.stubReplyFa(
        input,
        lessonTitle,
        this.faLessonFocus(lessonTitle, objective),
      );
    }
    return this.stubReplyEn(input, lessonTitle, objective, firstBeat);
  }

  /** Arabic / Persian script → Farsi stub (no English body paste). */
  private detectReplyLang(input: string): 'fa' | 'en' {
    if (/[\u0600-\u06FF]/.test(input)) return 'fa';
    return 'en';
  }

  /** Rewrite English lesson bits into short Farsi coaching — never return English dumps. */
  private faLessonFocus(lessonTitle: string, objective: string): string {
    const blob = `${lessonTitle} ${objective}`.toLowerCase();
    if (
      blob.includes('contrast') ||
      blob.includes('wcag') ||
      blob.includes('aa ')
    ) {
      return 'این درس درباره پیدا کردن متنی است که کنتراست کافی ندارد و استاندارد WCAG AA (نسبت حدود ۴٫۵:۱) را رعایت نمی‌کند. باید عنصر ضعیف را تشخیص بدهی.';
    }
    if (blob.includes('accessib') || blob.includes('a11y')) {
      return 'این درس درباره دسترس‌پذیری است — طراحی طوری که افراد بیشتری بتوانند راحت استفاده کنند.';
    }
    if (blob.includes('hierarch') || blob.includes('layout')) {
      return 'این درس درباره سلسله‌مراتب بصری و چیدمان است — چه چیزی اول دیده می‌شود و چرا.';
    }
    if (blob.includes('persona') || blob.includes('research')) {
      return 'این درس درباره شناخت کاربر و روش‌های پژوهش است.';
    }
    if (blob.includes('wireframe') || blob.includes('prototype')) {
      return 'این درس درباره وایرفریم یا نمونه‌سازی است — ساختار قبل از جزئیات بصری.';
    }
    return `این درس («${lessonTitle}») یک مهارت طراحی UI/UX را تمرین می‌کند. هدف: مفهوم را بفهمی و در فعالیت درست تشخیصش بدهی — بدون حفظ برچسب‌های انگلیسی.`;
  }

  private stubReplyFa(
    input: string,
    lessonTitle: string,
    focusFa: string,
  ): string {
    const q = input.toLowerCase();

    // Concept Q — answer the term, don't dump lesson menu.
    if (
      /\bwcag\b/i.test(input) ||
      q.includes('دابلیو') ||
      q.includes('دبل')
    ) {
      return [
        'WCAG مخفف Web Content Accessibility Guidelines است — راهنمای دسترس‌پذیری محتوای وب از W3C.',
        'سطح AA یک سطح انطباق رایج است: برای متن معمولی، نسبت کنتراست حداقل حدود ۴٫۵:۱ لازم است تا خوانایی برای افراد بیشتری حفظ شود.',
        `در درس «${lessonTitle}» باید عنصری را پیدا کنی که این نسبت را رعایت نمی‌کند.`,
      ].join(' ');
    }

    if (
      q.includes('کنتراست') ||
      /\bcontrast\b/i.test(input) ||
      q.includes('نسبت')
    ) {
      return [
        'کنتراست یعنی تفاوت روشنایی بین متن و پس‌زمینه.',
        'اگر نسبت کم باشد، متن سخت‌خوان می‌شود. برای WCAG AA معمولاً حداقل حدود ۴٫۵:۱ برای متن عادی لازم است.',
        `در «${lessonTitle}» دنبال متنی باش که رنگش خیلی نزدیک پس‌زمینه است.`,
      ].join(' ');
    }

    if (
      q.includes('فارسی') ||
      q.includes('پارسی') ||
      q.includes('بلدی') ||
      q.includes('می‌دونی') ||
      q.includes('میدونی')
    ) {
      return [
        'بله، کامل به فارسی جواب می‌دم.',
        `الان روی «${lessonTitle}» هستیم.`,
        focusFa,
        'هر بخش از درس را بپرس — مثلاً یک اصطلاح یا قانون.',
      ].join(' ');
    }

    if (
      q.includes('خلاصه') ||
      q.includes('جمع‌بندی') ||
      q.includes('جمع بندی')
    ) {
      return [
        `خلاصه ۶۰ثانیه‌ای «${lessonTitle}»:`,
        focusFa,
        'با زبان خودت بگو، بعد یک تمرین کوچک بزن.',
      ].join(' ');
    }

    if (
      q.includes('راهنما') ||
      q.includes('کمک') ||
      q.includes('گیر') ||
      q.includes('سخت') ||
      q.includes('نمی‌دونم') ||
      q.includes('نمیدونم')
    ) {
      return [
        `راهنمایی برای «${lessonTitle}»:`,
        focusFa,
        'چیزی که می‌بینی را نام ببر، بعد با قانون درس مقایسه کن. جواب قطعی نمی‌دم.',
      ].join(' ');
    }

    if (
      q.includes('چرا') ||
      q.includes('چطور') ||
      q.includes('چگونه') ||
      q.includes('یعنی') ||
      q.includes('معنی') ||
      q.includes('چیه') ||
      q.includes('چی هست') ||
      q.includes('توضیح')
    ) {
      return [
        `درباره سوالت در درس «${lessonTitle}»:`,
        focusFa,
        'اگر اصطلاح خاصی مد نظرته، همان را نام ببر تا دقیق‌تر بگم.',
      ].join(' ');
    }

    return [
      `سوالت را درباره «${lessonTitle}» این‌طور می‌فهمم —`,
      focusFa,
      'اگر بخش خاصی از متن درس را می‌پرسی، همان عبارت را دوباره بنویس تا همان را توضیح بدم.',
    ].join(' ');
  }

  private stubReplyEn(
    input: string,
    lessonTitle: string,
    objective: string,
    firstBeat: string | undefined,
  ): string {
    const q = input.toLowerCase();

    if (q.includes('recap') || q.includes('summar')) {
      return [
        `60-sec recap of “${lessonTitle}”:`,
        objective,
        firstBeat ? `Key beat: ${firstBeat}` : null,
        'Say that back in your own words, then try one quick practice.',
      ]
        .filter(Boolean)
        .join(' ');
    }

    if (
      q.includes('hint') ||
      q.includes('stuck') ||
      q.includes('help') ||
      q.includes('clue')
    ) {
      return [
        `Hint for “${lessonTitle}”: start from the objective — ${objective}.`,
        firstBeat
          ? `Look for the mismatch called out here: ${firstBeat}`
          : 'Name what you see, then compare it to the rule this lesson teaches.',
        'I will not give the exact answer — check your pick against that rule.',
      ].join(' ');
    }

    if (
      q.includes('explain') ||
      q.includes('what is') ||
      q.includes('what’s') ||
      q.includes("what's") ||
      q.includes('why') ||
      q.includes('how') ||
      q.includes('mean')
    ) {
      return [
        `“${lessonTitle}” is about this: ${objective}.`,
        firstBeat ? `In the lesson: ${firstBeat}` : null,
        'Focus on the rule, not memorizing labels — then re-check the activity.',
      ]
        .filter(Boolean)
        .join(' ');
    }

    if (
      q.includes('quiz') ||
      q.includes('practice') ||
      q.includes('example') ||
      q.includes('analogy')
    ) {
      return [
        `For “${lessonTitle}”, use this as your north star: ${objective}.`,
        'Try one tiny example in your head, then re-run the activity.',
        'Wrong guesses are useful — note which rule you skipped.',
      ].join(' ');
    }

    return [
      `On “${lessonTitle}”: ${objective}.`,
      firstBeat ? `Useful detail: ${firstBeat}` : null,
      'Ask for a recap, a hint, or why it matters — or rephrase your question and I’ll stay on this lesson.',
    ]
      .filter(Boolean)
      .join(' ');
  }
}
