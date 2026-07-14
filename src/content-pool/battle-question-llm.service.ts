import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import { LlmService } from '../common/llm/llm.service';
import { LessonTemplate } from '../skill-graph/entities/lesson-template.entity';
import { SkillNode } from '../skill-graph/entities/skill-node.entity';
import { TechStack } from '../skill-graph/entities/tech-stack.entity';
import { BattleCatalogService } from './battle-catalog.service';
import { ContentPublicationStatus } from './content-pool.constants';
import { LessonVersion } from './entities/lesson-version.entity';
import type {
  BattleQuestionSelectInput,
  BattleQuestionSet,
  BattleQuestionSnapshot,
} from './question-pool.service';

type LlmMcQuestion = {
  stem: string;
  options: Array<{ id: string; label: string }>;
  correctOptionId: string;
  explanation: string;
  difficulty: string;
};

@Injectable()
export class BattleQuestionLlmService {
  private readonly logger = new Logger(BattleQuestionLlmService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly catalog: BattleCatalogService,
    @InjectRepository(TechStack)
    private readonly stacksRepo: Repository<TechStack>,
    @InjectRepository(SkillNode)
    private readonly skillsRepo: Repository<SkillNode>,
    @InjectRepository(LessonTemplate)
    private readonly lessonsRepo: Repository<LessonTemplate>,
    @InjectRepository(LessonVersion)
    private readonly lessonVersionsRepo: Repository<LessonVersion>,
  ) {}

  isConfigured(): boolean {
    return this.llm.isConfigured();
  }

  async generateBattleSet(
    input: BattleQuestionSelectInput,
  ): Promise<BattleQuestionSet | null> {
    if (!this.isConfigured()) return null;

    const stackSlug =
      (await this.catalog.resolveSubjectSlug(input.subject ?? '')) ??
      input.subject?.trim().toLowerCase().replace(/\s+/g, '-') ??
      null;
    if (!stackSlug) {
      this.logger.warn('Battle LLM skip — no subject');
      return null;
    }

    const skill =
      (input.skillNodeId
        ? await this.skillsRepo.findOne({
            where: { id: input.skillNodeId, isActive: true },
          })
        : null) ??
      (await this.catalog.resolveSkill(stackSlug, input.topic));

    const stack = await this.stacksRepo.findOne({
      where: { slug: stackSlug, isActive: true },
    });

    const context = await this.buildLessonContext(
      skill?.id ?? null,
      stack?.name ?? stackSlug,
      skill?.title ?? input.topic ?? 'general',
    );

    try {
      const generated = await this.callLlm({
        userId: input.userId,
        subject: stack?.name ?? stackSlug,
        topic: skill?.title ?? input.topic ?? 'general',
        count: input.count,
        difficultyMix: input.difficultyMix ?? ['medium'],
        secondsHint: input.secondsPerQuestion ?? 30,
        context,
      });
      if (!generated || generated.length < input.count) {
        this.logger.warn(
          `Battle LLM returned ${generated?.length ?? 0}/${input.count}`,
        );
        return null;
      }

      const questions = generated.slice(0, input.count).map((q) =>
        this.toSnapshot(q, stackSlug, input.secondsPerQuestion ?? 30),
      );

      return {
        mode: input.mode,
        questions,
        sharedVersionIds: questions.map((q) => q.questionVersionId),
      };
    } catch (err) {
      this.logger.warn(
        `Battle LLM failed (model=${await this.llm.getModel('battle')}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  private async buildLessonContext(
    skillNodeId: string | null,
    subjectName: string,
    topicName: string,
  ): Promise<string> {
    const lines: string[] = [
      `Subject: ${subjectName}`,
      `Topic / skill: ${topicName}`,
    ];

    if (!skillNodeId) {
      lines.push('(No skill-linked lessons — generate from topic knowledge.)');
      return lines.join('\n');
    }

    const skill = await this.skillsRepo.findOne({ where: { id: skillNodeId } });
    if (skill?.description) {
      lines.push(`Skill description: ${skill.description.slice(0, 500)}`);
    }

    const lessons = await this.lessonsRepo.find({
      where: { skillNodeId },
      order: { title: 'ASC' },
      take: 10,
    });

    const publishedIds = lessons
      .map((l) => l.publishedVersionId)
      .filter((id): id is string => Boolean(id));

    const versions = publishedIds.length
      ? await this.lessonVersionsRepo.find({
          where: {
            id: In(publishedIds),
            status: ContentPublicationStatus.Published,
          },
        })
      : [];
    const byId = new Map(versions.map((v) => [v.id, v]));

    for (const lesson of lessons) {
      lines.push(`\n## Lesson: ${lesson.title}`);
      if (lesson.missionNameTemplate) {
        lines.push(`Mission: ${lesson.missionNameTemplate}`);
      }
      const version = lesson.publishedVersionId
        ? byId.get(lesson.publishedVersionId)
        : null;
      if (version) {
        lines.push(this.extractBodyText(version.body).slice(0, 1800));
      }
    }

    const joined = lines.join('\n');
    // Cap total prompt context.
    return joined.slice(0, 12_000);
  }

  private extractBodyText(body: unknown): string {
    if (!body || typeof body !== 'object') return '';
    const b = body as {
      objective?: string;
      sections?: Array<{
        title?: string;
        blocks?: Array<Record<string, unknown>>;
      }>;
    };
    const parts: string[] = [];
    if (b.objective) parts.push(`Objective: ${b.objective}`);
    for (const section of b.sections ?? []) {
      if (section.title) parts.push(`### ${section.title}`);
      for (const block of section.blocks ?? []) {
        if (typeof block.body === 'string' && block.body.trim()) {
          parts.push(block.body.trim());
        }
        if (typeof block.code === 'string' && block.code.trim()) {
          parts.push(`Code:\n${block.code.trim()}`);
        }
      }
    }
    return parts.join('\n');
  }

  private async callLlm(input: {
    userId?: string;
    subject: string;
    topic: string;
    count: number;
    difficultyMix: string[];
    secondsHint: number;
    context: string;
  }): Promise<LlmMcQuestion[] | null> {
    if (!this.llm.isConfigured()) return null;

    const model = await this.llm.getModel('battle');
    const band =
      input.difficultyMix.length === 1
        ? input.difficultyMix[0]!
        : `mixed (${input.difficultyMix.join(', ')})`;

    const completion = await this.llm.chatCompletion({
      purpose: 'battle',
      userId: input.userId,
      request: {
        model,
        temperature: 0.55,
        max_tokens: Math.min(4000, 400 + input.count * 350),
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              'You write multiple-choice battle quiz questions for Arc.',
              'Ground every question in the provided lesson catalog content.',
              'Do not invent unrelated topics. Prefer definitions, syntax, behavior, and pitfalls from the lessons.',
              'Each question must be answerable in about the given seconds.',
              'Return JSON only:',
              '{"questions":[{"stem":"...","options":[{"id":"a","label":"..."},{"id":"b","label":"..."},{"id":"c","label":"..."},{"id":"d","label":"..."}],"correctOptionId":"a","explanation":"...","difficulty":"medium"}]}',
              'Rules: exactly 4 options with ids a,b,c,d; one correctOptionId; stems clear and self-contained; no "all of the above".',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `Generate exactly ${input.count} questions.`,
              `Subject: ${input.subject}`,
              `Topic: ${input.topic}`,
              `Difficulty: ${band}`,
              `Target seconds per question: ${input.secondsHint}`,
              '',
              'Lesson catalog grounding:',
              input.context,
            ].join('\n'),
          },
        ],
      },
    });

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) return null;

    const parsed = JSON.parse(content) as { questions?: unknown };
    if (!Array.isArray(parsed.questions)) return null;

    const out: LlmMcQuestion[] = [];
    for (const raw of parsed.questions) {
      const q = this.normalizeQuestion(raw, input.difficultyMix);
      if (q) out.push(q);
    }
    return out;
  }

  private normalizeQuestion(
    raw: unknown,
    difficultyMix: string[],
  ): LlmMcQuestion | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const stem = typeof r.stem === 'string' ? r.stem.trim() : '';
    if (!stem) return null;

    const defaultDiff = difficultyMix[0] ?? 'medium';
    let difficulty =
      typeof r.difficulty === 'string' ? r.difficulty.toLowerCase() : defaultDiff;
    if (!['easy', 'medium', 'hard', 'expert'].includes(difficulty)) {
      difficulty = defaultDiff === 'mixed' ? 'medium' : defaultDiff;
    }

    let options: Array<{ id: string; label: string }> = [];
    if (Array.isArray(r.options)) {
      options = r.options
        .map((o, i) => {
          if (!o || typeof o !== 'object') return null;
          const opt = o as Record<string, unknown>;
          const id =
            typeof opt.id === 'string' && opt.id.trim()
              ? opt.id.trim().toLowerCase()
              : ['a', 'b', 'c', 'd'][i] ?? String(i);
          const label =
            typeof opt.label === 'string'
              ? opt.label.trim()
              : typeof opt.text === 'string'
                ? opt.text.trim()
                : '';
          if (!label) return null;
          return { id, label };
        })
        .filter((o): o is { id: string; label: string } => Boolean(o));
    }

    if (options.length < 2) return null;
    options = options.slice(0, 4);
    while (options.length < 4) {
      const id = ['a', 'b', 'c', 'd'][options.length]!;
      options.push({ id, label: `Option ${id.toUpperCase()}` });
    }

    let correct =
      typeof r.correctOptionId === 'string'
        ? r.correctOptionId.trim().toLowerCase()
        : typeof r.correct_option_id === 'string'
          ? String(r.correct_option_id).trim().toLowerCase()
          : options[0]!.id;
    if (!options.some((o) => o.id === correct)) {
      correct = options[0]!.id;
    }

    const explanation =
      typeof r.explanation === 'string' && r.explanation.trim()
        ? r.explanation.trim()
        : `Correct: ${options.find((o) => o.id === correct)?.label ?? correct}`;

    return {
      stem,
      options,
      correctOptionId: correct,
      explanation,
      difficulty,
    };
  }

  private toSnapshot(
    q: LlmMcQuestion,
    stackSlug: string,
    estimatedSeconds: number,
  ): BattleQuestionSnapshot {
    const scoreByDiff: Record<string, number> = {
      easy: 0.25,
      medium: 0.5,
      hard: 0.75,
      expert: 0.95,
    };
    const difficulty = q.difficulty;
    const difficultyScore = scoreByDiff[difficulty] ?? 0.5;
    const templateId = randomUUID();
    const versionId = randomUUID();
    return {
      questionTemplateId: templateId,
      questionVersionId: versionId,
      version: 1,
      questionType: 'multiple_choice',
      difficulty,
      difficultyScore,
      estimatedSeconds,
      prompt: {
        stem: q.stem,
        source: 'llm',
        techStackSlug: stackSlug,
      },
      options: q.options,
      correctOptionIds: [q.correctOptionId],
      explanation: q.explanation,
      calibrationKey: `${difficulty}:${difficultyScore.toFixed(1)}`,
    };
  }
}
