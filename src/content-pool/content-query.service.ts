import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { LessonBodyPersonalizationJobs } from '../lessons/lesson-body-personalization.jobs';
import { LessonTemplate } from '../skill-graph/entities/lesson-template.entity';
import { Resource } from '../skill-graph/entities/resource.entity';
import { RoleRecipe } from '../skill-graph/entities/role-recipe.entity';
import { SkillNode } from '../skill-graph/entities/skill-node.entity';
import {
  RecipeSubgraph,
  SkillGraphService,
} from '../skill-graph/skill-graph.service';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import { Milestone } from '../roadmaps/entities/milestone.entity';
import { Roadmap } from '../roadmaps/entities/roadmap.entity';
import { RoadmapPhase } from '../roadmaps/entities/roadmap-phase.entity';
import { ContentPublicationStatus } from './content-pool.constants';
import { ContentAnalyticsService } from './content-analytics.service';
import { ContentCacheService } from './content-cache.service';
import { CareerRole } from './entities/career-role.entity';
import { LessonVersion } from './entities/lesson-version.entity';
import { QuestionTemplate } from './entities/question-template.entity';
import { QuestionVersion } from './entities/question-version.entity';
import { resolveQuestionAnswer } from './question-answer.util';

export type PlayableLessonVersion = {
  lessonTemplateId: string;
  lessonVersionId: string | null;
  version: number | null;
  status: ContentPublicationStatus;
  title: string;
  body: Record<string, unknown>;
  estimatedMinutes: number;
  rewardClass: string;
  language: string;
};

export type AssessmentQuestionPick = {
  questionTemplateId: string;
  questionVersionId: string;
  version: number;
  questionType: string;
  difficulty: string;
  estimatedSeconds: number;
  prompt: Record<string, unknown>;
  options: Array<{ id: string; label: string }>;
};

@Injectable()
export class ContentQueryService {
  constructor(
    private readonly skillGraph: SkillGraphService,
    private readonly cache: ContentCacheService,
    private readonly analytics: ContentAnalyticsService,
    @InjectRepository(RoleRecipe)
    private readonly recipesRepo: Repository<RoleRecipe>,
    @InjectRepository(CareerRole)
    private readonly careersRepo: Repository<CareerRole>,
    @InjectRepository(LessonTemplate)
    private readonly lessonsRepo: Repository<LessonTemplate>,
    @InjectRepository(LessonVersion)
    private readonly lessonVersionsRepo: Repository<LessonVersion>,
    @InjectRepository(Resource)
    private readonly resourcesRepo: Repository<Resource>,
    @InjectRepository(SkillNode)
    private readonly skillsRepo: Repository<SkillNode>,
    @InjectRepository(QuestionTemplate)
    private readonly questionsRepo: Repository<QuestionTemplate>,
    @InjectRepository(QuestionVersion)
    private readonly questionVersionsRepo: Repository<QuestionVersion>,
    @InjectRepository(Roadmap)
    private readonly roadmapsRepo: Repository<Roadmap>,
    @InjectRepository(RoadmapPhase)
    private readonly phasesRepo: Repository<RoadmapPhase>,
    @InjectRepository(Milestone)
    private readonly milestonesRepo: Repository<Milestone>,
    @InjectRepository(Lesson)
    private readonly userLessonsRepo: Repository<Lesson>,
    @Optional()
    private readonly bodyPersonalizationJobs?: LessonBodyPersonalizationJobs | null,
  ) {}

  async getRoleRecipe(roleSlug: string): Promise<RoleRecipe> {
    return this.getRoleRecipeForRoles([roleSlug]);
  }

  async getRoleRecipeForRoles(roleSlugs: string[]): Promise<RoleRecipe> {
    const recipe = await this.skillGraph.findFirstRecipeForRoles(roleSlugs);
    if (!recipe) {
      throw new AppException(
        AuthErrorCode.CONTENT_ROLE_RECIPE_MISSING,
        `No role recipe for ${roleSlugs.filter(Boolean).join(', ') || '(none)'}`,
        HttpStatus.NOT_FOUND,
      );
    }
    const key = this.cache.recipeKey(recipe.targetRoleSlug, recipe.version);
    this.cache.set(key, {
      id: recipe.id,
      version: recipe.version,
      targetRoleSlug: recipe.targetRoleSlug,
    });
    return recipe;
  }

  async getCareerRole(slug: string): Promise<CareerRole | null> {
    return this.careersRepo.findOne({ where: { slug, isActive: true } });
  }

  async loadSubgraphForRecipe(recipe: RoleRecipe): Promise<RecipeSubgraph> {
    const key = this.cache.graphKey(recipe.id, recipe.version);
    const cached = this.cache.get<RecipeSubgraph>(key);
    if (cached) return cached;
    const subgraph = await this.skillGraph.loadSubgraphForRecipe(recipe);
    this.cache.set(key, subgraph);
    return subgraph;
  }

  async getPlayableLessonVersion(
    lessonTemplateId: string,
    preferredLanguage = 'en',
  ): Promise<PlayableLessonVersion> {
    const template = await this.lessonsRepo.findOne({
      where: { id: lessonTemplateId },
    });
    if (!template) {
      throw new AppException(
        AuthErrorCode.CONTENT_NOT_FOUND,
        'Lesson template not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (template.status === ContentPublicationStatus.Blocked) {
      throw new AppException(
        AuthErrorCode.CONTENT_VERSION_BLOCKED,
        'Lesson version is blocked',
        HttpStatus.FORBIDDEN,
      );
    }

    if (
      template.language &&
      template.language !== preferredLanguage &&
      template.language !== 'en'
    ) {
      // Prefer exact language; allow en fallback. Else fail hard.
      const alt = await this.lessonsRepo.findOne({
        where: {
          skillNodeId: template.skillNodeId,
          language: preferredLanguage,
          status: ContentPublicationStatus.Published,
          isActive: true,
        },
      });
      if (!alt && preferredLanguage !== 'en') {
        throw new AppException(
          AuthErrorCode.CONTENT_LANGUAGE_UNAVAILABLE,
          `No published content in language ${preferredLanguage}`,
          HttpStatus.NOT_FOUND,
        );
      }
    }

    let version: LessonVersion | null = null;
    if (template.publishedVersionId) {
      version = await this.lessonVersionsRepo.findOne({
        where: { id: template.publishedVersionId },
      });
    }
    if (!version) {
      version = await this.lessonVersionsRepo.findOne({
        where: {
          lessonTemplateId: template.id,
          status: ContentPublicationStatus.Published,
        },
        order: { version: 'DESC' },
      });
    }

    if (version?.status === ContentPublicationStatus.Blocked) {
      throw new AppException(
        AuthErrorCode.CONTENT_VERSION_BLOCKED,
        'Lesson version is blocked',
        HttpStatus.FORBIDDEN,
      );
    }

    const body =
      version && version.status === ContentPublicationStatus.Published
        ? (version.body as Record<string, unknown>)
        : template.contentOutline;

    if (version && version.status !== ContentPublicationStatus.Published) {
      throw new AppException(
        AuthErrorCode.CONTENT_VERSION_NOT_PUBLISHED,
        'No published lesson version',
        HttpStatus.CONFLICT,
      );
    }

    if (!version && template.status !== ContentPublicationStatus.Published) {
      throw new AppException(
        AuthErrorCode.CONTENT_VERSION_NOT_PUBLISHED,
        'Lesson template is not published',
        HttpStatus.CONFLICT,
      );
    }

    return {
      lessonTemplateId: template.id,
      lessonVersionId: version?.id ?? null,
      version: version?.version ?? null,
      status: version?.status ?? template.status,
      title: template.title,
      body,
      estimatedMinutes: template.estimatedMinutes,
      rewardClass: template.rewardClass,
      language: template.language ?? 'en',
    };
  }

  async getLessonVersionById(versionId: string): Promise<LessonVersion | null> {
    return this.lessonVersionsRepo.findOne({ where: { id: versionId } });
  }

  async assertResourceActive(resourceId: string): Promise<Resource> {
    const resource = await this.resourcesRepo.findOne({
      where: { id: resourceId },
    });
    if (!resource || !resource.isActive) {
      throw new AppException(
        AuthErrorCode.CONTENT_RESOURCE_INACTIVE,
        'Resource inactive or missing',
        HttpStatus.BAD_REQUEST,
      );
    }
    return resource;
  }

  async selectAssessmentQuestions(input: {
    skillNodeId?: string;
    techStackSlug?: string;
    count: number;
    excludeVersionIds?: string[];
  }): Promise<AssessmentQuestionPick[]> {
    const where: Record<string, unknown> = {
      isActive: true,
      status: ContentPublicationStatus.Published,
    };
    if (input.skillNodeId) where.skillNodeId = input.skillNodeId;
    if (input.techStackSlug) where.techStackSlug = input.techStackSlug;

    const templates = await this.questionsRepo.find({ where });
    const publishedIds = templates
      .map((t) => t.publishedVersionId)
      .filter((id): id is string => Boolean(id));

    if (!publishedIds.length) {
      throw new AppException(
        AuthErrorCode.CONTENT_QUESTION_POOL_TOO_SMALL,
        'Assessment question pool empty',
        HttpStatus.BAD_REQUEST,
      );
    }

    const versions = await this.questionVersionsRepo.find({
      where: {
        id: In(publishedIds),
        status: ContentPublicationStatus.Published,
      },
    });

    const excluded = new Set(input.excludeVersionIds ?? []);
    const eligible = versions.filter((v) => !excluded.has(v.id));
    if (eligible.length < input.count) {
      throw new AppException(
        AuthErrorCode.CONTENT_QUESTION_POOL_TOO_SMALL,
        `Need ${input.count} questions, have ${eligible.length}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const shuffled = [...eligible].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, input.count);
    const byId = new Map(templates.map((t) => [t.id, t]));

    return picked.map((v) => {
      const template = byId.get(v.questionTemplateId)!;
      const answer = resolveQuestionAnswer(v);
      return {
        questionTemplateId: template.id,
        questionVersionId: v.id,
        version: v.version,
        questionType: template.questionType,
        difficulty: template.difficulty,
        estimatedSeconds: template.estimatedSeconds,
        prompt: v.prompt as Record<string, unknown>,
        options: (answer.options ?? []).map((o) => ({
          id: o.id,
          label: o.label,
        })),
      };
    });
  }

  async listSkillsByIds(ids: string[]): Promise<SkillNode[]> {
    if (!ids.length) return [];
    return this.skillsRepo.find({ where: { id: In(ids), isActive: true } });
  }

  /**
   * Materialize next 2–4 weeks of lesson bodies onto user lesson instances.
   * Full roadmap outline stays; only window lessons get sourceVersion + playContent.
   */
  async materializeRoadmapContent(
    roadmapId: string,
    window: { weeks: number; fromWeek?: number },
  ): Promise<{
    roadmapId: string;
    weeks: number;
    fromWeek: number;
    materializedLessonIds: string[];
    status: 'ready';
  }> {
    const weeks = Math.min(4, Math.max(2, window.weeks || 2));
    const fromWeek = Math.max(1, window.fromWeek ?? 1);

    const roadmap = await this.roadmapsRepo.findOne({
      where: { id: roadmapId },
    });
    if (!roadmap) {
      throw new AppException(
        AuthErrorCode.ROADMAP_NOT_FOUND,
        'Roadmap not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const phases = await this.phasesRepo.find({
      where: { roadmapId },
      order: { orderIndex: 'ASC' },
    });
    const phaseIds = phases.map((p) => p.id);
    if (!phaseIds.length) {
      return {
        roadmapId,
        weeks,
        fromWeek,
        materializedLessonIds: [],
        status: 'ready',
      };
    }

    const milestones = await this.milestonesRepo.find({
      where: { phaseId: In(phaseIds) },
      order: { orderIndex: 'ASC' },
    });
    const milestoneIds = milestones.map((m) => m.id);
    const lessons = milestoneIds.length
      ? await this.userLessonsRepo.find({
          where: { milestoneId: In(milestoneIds) },
          order: { orderIndex: 'ASC' },
        })
      : [];

    // Flatten in phase → milestone → lesson order, then slice by week windows.
    const ordered: Lesson[] = [];
    for (const phase of phases) {
      const ms = milestones
        .filter((m) => m.phaseId === phase.id)
        .sort((a, b) => a.orderIndex - b.orderIndex);
      for (const m of ms) {
        ordered.push(
          ...lessons
            .filter((l) => l.milestoneId === m.id)
            .sort((a, b) => a.orderIndex - b.orderIndex),
        );
      }
    }

    const avgPerWeek = Math.max(
      1,
      Math.ceil(ordered.length / Math.max(1, roadmap.timelineWeeks)),
    );
    const start = (fromWeek - 1) * avgPerWeek;
    const end = start + weeks * avgPerWeek;
    const batch = ordered.slice(start, end);

    const materializedLessonIds: string[] = [];
    for (const lesson of batch) {
      if (!lesson.lessonTemplateId) continue;
      try {
        const playable = await this.getPlayableLessonVersion(
          lesson.lessonTemplateId,
        );
        lesson.sourceVersionId = playable.lessonVersionId;
        lesson.rewardClassSnapshot = playable.rewardClass;
        lesson.materializedWindow = fromWeek;
        if (!lesson.playContent && playable.body) {
          lesson.playContent = playable.body;
        }
        await this.userLessonsRepo.save(lesson);
        materializedLessonIds.push(lesson.id);
      } catch {
        /* skip unpublished templates in window */
      }
    }

    this.analytics.emit('content_batch_materialized', {
      roadmapId,
      fromWeek,
      weeks,
      count: materializedLessonIds.length,
    });

    if (this.bodyPersonalizationJobs && materializedLessonIds.length) {
      try {
        await this.bodyPersonalizationJobs.enqueueForMaterializedLessons({
          roadmapId,
          userId: roadmap.userId,
          lessonIds: materializedLessonIds,
        });
      } catch {
        /* personalization is best-effort; scaffold already playable */
      }
    }

    return {
      roadmapId,
      weeks,
      fromWeek,
      materializedLessonIds,
      status: 'ready',
    };
  }

  /** Admin FTS-style discovery across lesson templates. */
  async searchLessons(q: string, limit = 50) {
    const qb = this.lessonsRepo
      .createQueryBuilder('l')
      .where('l.is_active = true')
      .orderBy('l.title', 'ASC')
      .take(limit);
    if (q?.trim()) {
      qb.andWhere(`(l.title ILIKE :q OR l.slug ILIKE :q)`, {
        q: `%${q.trim()}%`,
      });
    }
    return qb.getMany();
  }
}
