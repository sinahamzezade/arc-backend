import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { LessonTemplate } from '../skill-graph/entities/lesson-template.entity';
import { ContentPublicationStatus } from './content-pool.constants';
import { ContentAuditLog } from './entities/content-audit-log.entity';
import {
  LessonVersion,
  type LessonVersionBody,
} from './entities/lesson-version.entity';
import { QuestionTemplate } from './entities/question-template.entity';
import {
  QuestionVersion,
  type QuestionVersionAnswer,
  type QuestionVersionPrompt,
} from './entities/question-version.entity';
import { sanitizeBodyDeep } from './content-security.util';
import { sealQuestionAnswer } from './question-answer.util';

@Injectable()
export class ContentVersionService {
  constructor(
    @InjectRepository(LessonTemplate)
    private readonly lessonsRepo: Repository<LessonTemplate>,
    @InjectRepository(LessonVersion)
    private readonly lessonVersionsRepo: Repository<LessonVersion>,
    @InjectRepository(QuestionTemplate)
    private readonly questionsRepo: Repository<QuestionTemplate>,
    @InjectRepository(QuestionVersion)
    private readonly questionVersionsRepo: Repository<QuestionVersion>,
    @InjectRepository(ContentAuditLog)
    private readonly auditRepo: Repository<ContentAuditLog>,
  ) {}

  async createLessonTemplate(input: {
    skillNodeId: string;
    slug: string;
    title: string;
    lessonType: string;
    estimatedMinutes?: number;
    difficulty?: string;
    learningStyleTags?: string[];
    schedulingTags?: string[];
    language?: string;
    missionNameTemplate?: string;
    authorId?: string;
  }): Promise<LessonTemplate> {
    const template = await this.lessonsRepo.save(
      this.lessonsRepo.create({
        skillNodeId: input.skillNodeId,
        slug: input.slug,
        title: input.title,
        lessonType: input.lessonType,
        estimatedMinutes: input.estimatedMinutes ?? 20,
        difficulty: input.difficulty ?? 'beginner',
        learningStyleTags: input.learningStyleTags ?? [],
        schedulingTags: input.schedulingTags ?? [],
        language: input.language ?? 'en',
        missionNameTemplate: input.missionNameTemplate ?? null,
        status: ContentPublicationStatus.Draft,
        isActive: true,
        contentOutline: {},
      }),
    );

    await this.auditRepo.save(
      this.auditRepo.create({
        actorId: input.authorId ?? null,
        action: 'create',
        entityType: 'lesson_template',
        entityId: template.id,
        metadata: { slug: template.slug },
      }),
    );

    return template;
  }

  async createLessonVersion(input: {
    lessonTemplateId: string;
    body: LessonVersionBody;
    changeNote?: string;
    authorId?: string;
  }): Promise<LessonVersion> {
    const template = await this.lessonsRepo.findOne({
      where: { id: input.lessonTemplateId },
    });
    if (!template) {
      throw new AppException(
        AuthErrorCode.CONTENT_NOT_FOUND,
        'Lesson template not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const latest = await this.lessonVersionsRepo.findOne({
      where: { lessonTemplateId: template.id },
      order: { version: 'DESC' },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    const row = await this.lessonVersionsRepo.save(
      this.lessonVersionsRepo.create({
        lessonTemplateId: template.id,
        version: nextVersion,
        status: ContentPublicationStatus.Draft,
        body: sanitizeBodyDeep(input.body) as LessonVersionBody,
        schemaVersion: input.body.schemaVersion ?? 2,
        changeNote: input.changeNote ?? '',
        authorId: input.authorId ?? null,
      }),
    );

    await this.auditRepo.save(
      this.auditRepo.create({
        actorId: input.authorId ?? null,
        action: 'create_version',
        entityType: 'lesson_version',
        entityId: row.id,
        metadata: { lessonTemplateId: template.id, version: nextVersion },
      }),
    );

    return row;
  }

  async createQuestionTemplate(input: {
    slug: string;
    questionType: string;
    skillNodeId?: string;
    techStackSlug?: string;
    difficulty?: string;
    estimatedSeconds?: number;
    allowedContexts?: string[];
    authorId?: string;
  }): Promise<QuestionTemplate> {
    const template = await this.questionsRepo.save(
      this.questionsRepo.create({
        slug: input.slug,
        questionType: input.questionType,
        skillNodeId: input.skillNodeId ?? null,
        techStackSlug: input.techStackSlug ?? null,
        difficulty: input.difficulty ?? 'beginner',
        estimatedSeconds: input.estimatedSeconds ?? 45,
        allowedContexts: (input.allowedContexts as QuestionTemplate['allowedContexts']) ?? [
          'lesson',
          'assessment',
          'battle',
        ],
        status: ContentPublicationStatus.Draft,
        isActive: true,
      }),
    );

    await this.auditRepo.save(
      this.auditRepo.create({
        actorId: input.authorId ?? null,
        action: 'create',
        entityType: 'question_template',
        entityId: template.id,
        metadata: { slug: template.slug },
      }),
    );

    return template;
  }

  async createQuestionVersion(input: {
    questionTemplateId: string;
    prompt: QuestionVersionPrompt;
    answer: QuestionVersionAnswer;
    explanation?: string;
    changeNote?: string;
    authorId?: string;
  }): Promise<QuestionVersion> {
    const template = await this.questionsRepo.findOne({
      where: { id: input.questionTemplateId },
    });
    if (!template) {
      throw new AppException(
        AuthErrorCode.CONTENT_NOT_FOUND,
        'Question template not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const latest = await this.questionVersionsRepo.findOne({
      where: { questionTemplateId: template.id },
      order: { version: 'DESC' },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    const row = await this.questionVersionsRepo.save(
      this.questionVersionsRepo.create({
        questionTemplateId: template.id,
        version: nextVersion,
        status: ContentPublicationStatus.Draft,
        prompt: sanitizeBodyDeep(input.prompt) as QuestionVersionPrompt,
        answer: sealQuestionAnswer(input.answer),
        explanation: input.explanation ?? '',
        changeNote: input.changeNote ?? '',
        authorId: input.authorId ?? null,
      }),
    );

    await this.auditRepo.save(
      this.auditRepo.create({
        actorId: input.authorId ?? null,
        action: 'create_version',
        entityType: 'question_version',
        entityId: row.id,
        metadata: { questionTemplateId: template.id, version: nextVersion },
      }),
    );

    return row;
  }
}
