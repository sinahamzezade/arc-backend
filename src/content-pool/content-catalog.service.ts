import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { SkillNode } from '../skill-graph/entities/skill-node.entity';
import { ContentPublicationStatus } from './content-pool.constants';
import { ContentAnalyticsService } from './content-analytics.service';
import { ContentAuditLog } from './entities/content-audit-log.entity';
import { CourseTemplate } from './entities/course-template.entity';
import { Dataset } from './entities/dataset.entity';
import { ModuleTemplate } from './entities/module-template.entity';
import { SkillPrerequisite } from './entities/skill-prerequisite.entity';

@Injectable()
export class ContentCatalogService {
  constructor(
    @InjectRepository(CourseTemplate)
    private readonly coursesRepo: Repository<CourseTemplate>,
    @InjectRepository(ModuleTemplate)
    private readonly modulesRepo: Repository<ModuleTemplate>,
    @InjectRepository(Dataset)
    private readonly datasetsRepo: Repository<Dataset>,
    @InjectRepository(SkillPrerequisite)
    private readonly prereqsRepo: Repository<SkillPrerequisite>,
    @InjectRepository(SkillNode)
    private readonly skillsRepo: Repository<SkillNode>,
    @InjectRepository(ContentAuditLog)
    private readonly auditRepo: Repository<ContentAuditLog>,
    private readonly analytics: ContentAnalyticsService,
  ) {}

  listCourses(q?: string) {
    return this.coursesRepo.find({
      where: q
        ? [{ title: ILike(`%${q}%`) }, { slug: ILike(`%${q}%`) }]
        : { isActive: true },
      order: { title: 'ASC' },
      take: 100,
    });
  }

  async createCourse(
    input: Partial<CourseTemplate> & { slug: string; title: string },
    actorId?: string,
  ) {
    const row = await this.coursesRepo.save(
      this.coursesRepo.create({
        slug: input.slug,
        title: input.title,
        learningOutcome: input.learningOutcome ?? '',
        careerRoleId: input.careerRoleId ?? null,
        techStackSlugs: input.techStackSlugs ?? [],
        difficultyMin: input.difficultyMin ?? 'beginner',
        difficultyMax: input.difficultyMax ?? 'advanced',
        isRequired: input.isRequired ?? true,
        estimatedTotalMinutes: input.estimatedTotalMinutes ?? 0,
        language: input.language ?? 'en',
        version: input.version ?? 1,
        status: ContentPublicationStatus.Draft,
        isActive: true,
      }),
    );
    await this.audit('create', 'course_template', row.id, actorId);
    return row;
  }

  listModules(courseTemplateId?: string) {
    return this.modulesRepo.find({
      where: courseTemplateId
        ? { courseTemplateId, isActive: true }
        : { isActive: true },
      order: { orderHint: 'ASC' },
      take: 200,
    });
  }

  async createModule(
    input: {
      courseTemplateId: string;
      slug: string;
      title: string;
      lessonTemplateIds?: string[];
      orderHint?: number;
      estimatedMinutes?: number;
    },
    actorId?: string,
  ) {
    const course = await this.coursesRepo.findOne({
      where: { id: input.courseTemplateId },
    });
    if (!course) {
      throw new AppException(
        AuthErrorCode.CONTENT_NOT_FOUND,
        'Course template not found',
        HttpStatus.NOT_FOUND,
      );
    }
    const row = await this.modulesRepo.save(
      this.modulesRepo.create({
        courseTemplateId: input.courseTemplateId,
        slug: input.slug,
        title: input.title,
        lessonTemplateIds: input.lessonTemplateIds ?? [],
        orderHint: input.orderHint ?? 0,
        estimatedMinutes: input.estimatedMinutes ?? 0,
        status: ContentPublicationStatus.Draft,
        isActive: true,
      }),
    );
    await this.audit('create', 'module_template', row.id, actorId);
    return row;
  }

  listDatasets(q?: string) {
    return this.datasetsRepo.find({
      where: q
        ? [{ title: ILike(`%${q}%`) }, { slug: ILike(`%${q}%`) }]
        : { isActive: true },
      order: { title: 'ASC' },
      take: 100,
    });
  }

  async createDataset(
    input: {
      slug: string;
      title: string;
      storageKey: string;
      checksum: string;
      format?: string;
      license?: string;
      source?: string;
      schemaMetadata?: Record<string, unknown>;
      previewRows?: unknown[];
      allowedLessonTemplateIds?: string[];
      sizeBytes?: string;
    },
    actorId?: string,
  ) {
    const row = await this.datasetsRepo.save(
      this.datasetsRepo.create({
        slug: input.slug,
        title: input.title,
        storageKey: input.storageKey,
        checksum: input.checksum,
        format: input.format ?? 'csv',
        license: input.license ?? null,
        source: input.source ?? null,
        schemaMetadata: input.schemaMetadata ?? {},
        previewRows: input.previewRows ?? [],
        allowedLessonTemplateIds: input.allowedLessonTemplateIds ?? [],
        sizeBytes: input.sizeBytes ?? '0',
        isActive: true,
      }),
    );
    await this.audit('create', 'dataset', row.id, actorId);
    return row;
  }

  async getDataset(id: string) {
    const row = await this.datasetsRepo.findOne({ where: { id } });
    if (!row || !row.isActive) {
      throw new AppException(
        AuthErrorCode.CONTENT_NOT_FOUND,
        'Dataset not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return row;
  }

  async syncPrerequisiteEdges(actorId?: string): Promise<{ synced: number }> {
    const skills = await this.skillsRepo.find({ where: { isActive: true } });
    let synced = 0;
    for (const skill of skills) {
      for (const prereqId of skill.prerequisiteSkillIds ?? []) {
        const existing = await this.prereqsRepo.findOne({
          where: { skillNodeId: skill.id, prerequisiteSkillId: prereqId },
        });
        if (existing) continue;
        await this.prereqsRepo.save(
          this.prereqsRepo.create({
            skillNodeId: skill.id,
            prerequisiteSkillId: prereqId,
          }),
        );
        synced += 1;
      }
    }
    await this.audit('sync_prereqs', 'skill_prerequisite', 'bulk', actorId, {
      synced,
    });
    return { synced };
  }

  async listPrerequisiteEdges(skillNodeId?: string) {
    return this.prereqsRepo.find({
      where: skillNodeId ? { skillNodeId } : {},
      take: 500,
    });
  }

  /** Soft resource/dataset integrity check stub. */
  async checkDatasetIntegrity(id: string) {
    const ds = await this.getDataset(id);
    const ok = Boolean(ds.storageKey && ds.checksum);
    if (!ok) {
      this.analytics.emit('content_resource_failed', {
        datasetId: id,
        reason: 'missing_key_or_checksum',
      });
    }
    return { id, ok, checksum: ds.checksum, storageKey: ds.storageKey };
  }

  private async audit(
    action: string,
    entityType: string,
    entityId: string,
    actorId?: string,
    metadata: Record<string, unknown> = {},
  ) {
    await this.auditRepo.save(
      this.auditRepo.create({
        actorId: actorId ?? null,
        action,
        entityType,
        entityId,
        metadata,
      }),
    );
  }
}
