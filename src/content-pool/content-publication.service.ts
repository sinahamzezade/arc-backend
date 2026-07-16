import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { SkillNode } from '../skill-graph/entities/skill-node.entity';
import { ContentPublicationStatus } from './content-pool.constants';
import { ContentAnalyticsService } from './content-analytics.service';
import { ContentCacheService } from './content-cache.service';
import { ContentAuditLog } from './entities/content-audit-log.entity';
import { LessonVersion } from './entities/lesson-version.entity';
import { QuestionTemplate } from './entities/question-template.entity';
import { QuestionVersion } from './entities/question-version.entity';
import { LessonTemplate } from '../skill-graph/entities/lesson-template.entity';

const NEXT_STATUS: Record<
  ContentPublicationStatus,
  ContentPublicationStatus[]
> = {
  [ContentPublicationStatus.Draft]: [
    ContentPublicationStatus.Review,
    ContentPublicationStatus.Blocked,
  ],
  [ContentPublicationStatus.Review]: [
    ContentPublicationStatus.Published,
    ContentPublicationStatus.Draft,
    ContentPublicationStatus.Blocked,
  ],
  [ContentPublicationStatus.Published]: [
    ContentPublicationStatus.Retired,
    ContentPublicationStatus.Blocked,
  ],
  [ContentPublicationStatus.Retired]: [ContentPublicationStatus.Blocked],
  [ContentPublicationStatus.Blocked]: [ContentPublicationStatus.Draft],
};

@Injectable()
export class ContentPublicationService {
  constructor(
    @InjectRepository(LessonTemplate)
    private readonly lessonsRepo: Repository<LessonTemplate>,
    @InjectRepository(LessonVersion)
    private readonly lessonVersionsRepo: Repository<LessonVersion>,
    @InjectRepository(QuestionTemplate)
    private readonly questionsRepo: Repository<QuestionTemplate>,
    @InjectRepository(QuestionVersion)
    private readonly questionVersionsRepo: Repository<QuestionVersion>,
    @InjectRepository(SkillNode)
    private readonly skillsRepo: Repository<SkillNode>,
    @InjectRepository(ContentAuditLog)
    private readonly auditRepo: Repository<ContentAuditLog>,
    private readonly cache: ContentCacheService,
    private readonly analytics: ContentAnalyticsService,
  ) {}

  async submitReview(
    entityType: 'lesson_version' | 'question_version',
    versionId: string,
    actorId?: string,
  ) {
    return this.transition(
      entityType,
      versionId,
      ContentPublicationStatus.Review,
      actorId,
    );
  }

  async publish(
    entityType: 'lesson_version' | 'question_version',
    versionId: string,
    actorId?: string,
  ) {
    const version = await this.transition(
      entityType,
      versionId,
      ContentPublicationStatus.Published,
      actorId,
    );

    if (entityType === 'lesson_version') {
      const lv = version as LessonVersion;
      await this.lessonsRepo.update(lv.lessonTemplateId, {
        publishedVersionId: lv.id,
        status: ContentPublicationStatus.Published,
      });
      lv.publishedAt = new Date();
      await this.lessonVersionsRepo.save(lv);
    } else {
      const qv = version as QuestionVersion;
      await this.questionsRepo.update(qv.questionTemplateId, {
        publishedVersionId: qv.id,
        status: ContentPublicationStatus.Published,
      });
      qv.publishedAt = new Date();
      await this.questionVersionsRepo.save(qv);
    }

    await this.cache.invalidatePrefix('content:recipe:');
    await this.cache.invalidatePrefix('content:graph:');
    this.analytics.emit('content_version_published', {
      entityType,
      versionId,
      actorId: actorId ?? null,
    });
    this.analytics.emit('content_cache_invalidated', { reason: 'publish' });

    return version;
  }

  async retire(
    entityType: 'lesson_version' | 'question_version',
    versionId: string,
    actorId?: string,
  ) {
    const version = await this.transition(
      entityType,
      versionId,
      ContentPublicationStatus.Retired,
      actorId,
    );

    if (entityType === 'lesson_version') {
      const lv = version as LessonVersion;
      const template = await this.lessonsRepo.findOne({
        where: { id: lv.lessonTemplateId },
      });
      if (template?.publishedVersionId === lv.id) {
        await this.lessonsRepo.update(template.id, {
          publishedVersionId: null,
          status: ContentPublicationStatus.Retired,
        });
      }
    } else {
      const qv = version as QuestionVersion;
      const template = await this.questionsRepo.findOne({
        where: { id: qv.questionTemplateId },
      });
      if (template?.publishedVersionId === qv.id) {
        await this.questionsRepo.update(template.id, {
          publishedVersionId: null,
          status: ContentPublicationStatus.Retired,
        });
      }
    }

    await this.cache.invalidatePrefix('content:recipe:');
    await this.cache.invalidatePrefix('content:graph:');
    this.analytics.emit('content_cache_invalidated', { reason: 'retire' });

    return version;
  }

  /**
   * Validate skill graph is a DAG. Throws CONTENT_GRAPH_CYCLE on cycle.
   */
  async validateGraph(): Promise<{
    ok: true;
    nodeCount: number;
    edgeCount: number;
  }> {
    const skills = await this.skillsRepo.find({ where: { isActive: true } });
    const ids = new Set(skills.map((s) => s.id));
    const adj = new Map<string, string[]>();

    let edgeCount = 0;
    for (const skill of skills) {
      const deps = (skill.prerequisiteSkillIds ?? []).filter((id) =>
        ids.has(id),
      );
      adj.set(skill.id, deps);
      edgeCount += deps.length;
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (id: string, path: string[]) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new AppException(
          AuthErrorCode.CONTENT_GRAPH_CYCLE,
          `Cycle detected: ${[...path, id].join(' → ')}`,
          HttpStatus.BAD_REQUEST,
        );
      }
      visiting.add(id);
      for (const prereq of adj.get(id) ?? []) {
        visit(prereq, [...path, id]);
      }
      visiting.delete(id);
      visited.add(id);
    };

    for (const skill of skills) {
      visit(skill.id, []);
    }

    return { ok: true, nodeCount: skills.length, edgeCount };
  }

  private async transition(
    entityType: 'lesson_version' | 'question_version',
    versionId: string,
    next: ContentPublicationStatus,
    actorId?: string,
  ) {
    const version =
      entityType === 'lesson_version'
        ? await this.lessonVersionsRepo.findOne({ where: { id: versionId } })
        : await this.questionVersionsRepo.findOne({ where: { id: versionId } });

    if (!version) {
      throw new AppException(
        AuthErrorCode.CONTENT_NOT_FOUND,
        'Content version not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const previous = version.status;
    const allowed = NEXT_STATUS[previous] ?? [];
    if (!allowed.includes(next)) {
      throw new AppException(
        AuthErrorCode.CONTENT_INVALID_TRANSITION,
        `Cannot move ${previous} → ${next}`,
        HttpStatus.CONFLICT,
      );
    }

    if (next === ContentPublicationStatus.Published) {
      await this.validateGraph();
    }

    version.status = next;
    if (actorId && next === ContentPublicationStatus.Published) {
      version.reviewerId = actorId;
    }

    const saved =
      entityType === 'lesson_version'
        ? await this.lessonVersionsRepo.save(version as LessonVersion)
        : await this.questionVersionsRepo.save(version as QuestionVersion);

    await this.auditRepo.save(
      this.auditRepo.create({
        actorId: actorId ?? null,
        action: `status:${next}`,
        entityType,
        entityId: versionId,
        metadata: { previous, next },
      }),
    );

    return saved;
  }
}
