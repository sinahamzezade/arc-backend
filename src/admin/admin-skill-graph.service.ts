import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ContentPublicationStatus } from '../content-pool/content-pool.constants';
import { CareerRole } from '../content-pool/entities/career-role.entity';
import { LessonTemplate } from '../skill-graph/entities/lesson-template.entity';
import { Resource } from '../skill-graph/entities/resource.entity';
import { RoleRecipe } from '../skill-graph/entities/role-recipe.entity';
import { SkillNode } from '../skill-graph/entities/skill-node.entity';
import { TechStack } from '../skill-graph/entities/tech-stack.entity';
import type {
  CatalogSeed,
  SeedLesson,
  SeedRecipe,
  SeedResource,
  SeedStack,
} from '../skill-graph/seeds/catalog.seed';
import {
  transformCurriculumLesson,
  validateTransformedOutline,
} from '../skill-graph/seeds/transform-curriculum';
import { RoadmapSnapshotService } from '../roadmaps/roadmap-snapshot.service';

const LESSON_TYPES = [
  'reading',
  'practice',
  'quiz',
  'reflection',
  'mini_project',
  'video',
] as const;

export type CatalogImportStats = {
  resourcesAdded: number;
  resourcesUpdated: number;
  stacksAdded: number;
  stacksUpdated: number;
  skillsAdded: number;
  skillsUpdated: number;
  lessonsAdded: number;
  lessonsUpdated: number;
  recipesAdded: number;
  recipesUpdated: number;
};

function resolveImportOutline(lessonSeed: SeedLesson, skillSlug: string) {
  if (!lessonSeed.content) {
    throw new BadRequestException(
      `Lesson "${lessonSeed.slug}" missing content — add body in course JSON`,
    );
  }
  const outline = transformCurriculumLesson({
    skillSlug,
    lessonSlug: lessonSeed.slug,
    title: lessonSeed.title,
    missionNameTemplate: lessonSeed.missionNameTemplate,
    lessonType: lessonSeed.lessonType,
    content: lessonSeed.content,
  });
  validateTransformedOutline(outline);
  return outline;
}

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function parseCsv(raw: string | undefined | null): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

@Injectable()
export class AdminSkillGraphService {
  private readonly logger = new Logger(AdminSkillGraphService.name);

  constructor(
    @InjectRepository(TechStack)
    private readonly stacks: Repository<TechStack>,
    @InjectRepository(SkillNode)
    private readonly skills: Repository<SkillNode>,
    @InjectRepository(LessonTemplate)
    private readonly lessons: Repository<LessonTemplate>,
    @InjectRepository(RoleRecipe)
    private readonly recipes: Repository<RoleRecipe>,
    @InjectRepository(Resource)
    private readonly resources: Repository<Resource>,
    @InjectRepository(CareerRole)
    private readonly careers: Repository<CareerRole>,
    private readonly dataSource: DataSource,
    private readonly roadmapSnapshots: RoadmapSnapshotService,
  ) {}

  lessonTypeChoices(current?: string) {
    return LESSON_TYPES.map((value) => ({
      value,
      label: value,
      selected: value === current,
    }));
  }

  async listStacks() {
    const rows = await this.stacks.find({
      order: { category: 'ASC', name: 'ASC' },
    });
    const skillCounts = await this.skills
      .createQueryBuilder('s')
      .select('s.tech_stack_id', 'stackId')
      .addSelect('COUNT(*)', 'count')
      .groupBy('s.tech_stack_id')
      .getRawMany<{ stackId: string; count: string }>();
    const countByStack = new Map(
      skillCounts.map((r) => [r.stackId, Number(r.count)]),
    );
    return rows.map((s) => ({
      ...s,
      skillCount: countByStack.get(s.id) ?? 0,
    }));
  }

  async getStack(id: string) {
    const stack = await this.stacks.findOne({ where: { id } });
    if (!stack) throw new NotFoundException('Stack not found');
    const skills = await this.skills.find({
      where: { techStackId: id },
      order: { orderHint: 'ASC', title: 'ASC' },
    });
    const lessonCounts = skills.length
      ? await this.lessons
          .createQueryBuilder('l')
          .select('l.skill_node_id', 'skillId')
          .addSelect('COUNT(*)', 'count')
          .where('l.skill_node_id IN (:...ids)', {
            ids: skills.map((s) => s.id),
          })
          .groupBy('l.skill_node_id')
          .getRawMany<{ skillId: string; count: string }>()
      : [];
    const countBySkill = new Map(
      lessonCounts.map((r) => [r.skillId, Number(r.count)]),
    );
    return {
      stack,
      skills: skills.map((s) => ({
        ...s,
        lessonCount: countBySkill.get(s.id) ?? 0,
        tagsCsv: (s.tags ?? []).join(', '),
      })),
    };
  }

  async createStack(input: {
    slug?: string;
    name: string;
    category?: string;
    description?: string;
  }) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Name required');
    const slug = slugify(input.slug?.trim() || name);
    if (!slug) throw new BadRequestException('Slug required');
    const exists = await this.stacks.findOne({ where: { slug } });
    if (exists) throw new BadRequestException(`Stack slug "${slug}" exists`);

    return this.stacks.save(
      this.stacks.create({
        slug,
        name,
        category: input.category?.trim() || 'general',
        description: input.description?.trim() ?? '',
        isActive: true,
      }),
    );
  }

  async updateStack(
    id: string,
    input: {
      name?: string;
      category?: string;
      description?: string;
      isActive?: boolean;
    },
  ) {
    const stack = await this.stacks.findOne({ where: { id } });
    if (!stack) throw new NotFoundException('Stack not found');
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('Name required');
      stack.name = name;
    }
    if (input.category !== undefined) {
      stack.category = input.category.trim() || 'general';
    }
    if (input.description !== undefined) {
      stack.description = input.description.trim();
    }
    if (input.isActive !== undefined) stack.isActive = input.isActive;
    return this.stacks.save(stack);
  }

  async deleteStack(id: string) {
    const stack = await this.stacks.findOne({ where: { id } });
    if (!stack) throw new NotFoundException('Stack not found');
    const skillIds = (
      await this.skills.find({
        where: { techStackId: id },
        select: { id: true },
      })
    ).map((s) => s.id);
    await this.dataSource.transaction(async (manager) => {
      if (skillIds.length) {
        await this.scrubSkillRefs(manager.getRepository(SkillNode), skillIds);
        await this.scrubRecipeSkillIds(
          manager.getRepository(RoleRecipe),
          skillIds,
        );
      }
      await manager.getRepository(TechStack).remove(stack);
    });
  }

  async createSkill(
    stackId: string,
    input: {
      slug?: string;
      title: string;
      description?: string;
      orderHint?: number;
      estimatedHours?: number;
      tags?: string;
      prereqSlugs?: string;
    },
  ) {
    const stack = await this.stacks.findOne({ where: { id: stackId } });
    if (!stack) throw new NotFoundException('Stack not found');
    const title = input.title.trim();
    if (!title) throw new BadRequestException('Title required');
    const slug = slugify(input.slug?.trim() || title);
    if (!slug) throw new BadRequestException('Slug required');
    const clash = await this.skills.findOne({
      where: { techStackId: stackId, slug },
    });
    if (clash) throw new BadRequestException(`Skill slug "${slug}" exists`);

    const hours =
      input.estimatedHours !== undefined && Number.isFinite(input.estimatedHours)
        ? input.estimatedHours
        : 1;
    const prereqIds = await this.resolvePrereqSlugs(
      stackId,
      parseCsv(input.prereqSlugs),
    );

    return this.skills.save(
      this.skills.create({
        techStackId: stackId,
        slug,
        title,
        description: input.description?.trim() ?? '',
        orderHint: input.orderHint ?? 0,
        estimatedHours: String(hours),
        estimatedMasteryMinutes: Math.round(hours * 60),
        tags: parseCsv(input.tags),
        prerequisiteSkillIds: prereqIds,
        isActive: true,
      }),
    );
  }

  async getSkill(id: string) {
    const skill = await this.skills.findOne({
      where: { id },
      relations: { techStack: true },
    });
    if (!skill) throw new NotFoundException('Skill not found');
    const lessons = await this.lessons.find({
      where: { skillNodeId: id },
      order: { orderHint: 'ASC', title: 'ASC' },
    });
    const siblings = await this.skills.find({
      where: { techStackId: skill.techStackId },
      order: { orderHint: 'ASC', title: 'ASC' },
    });
    const prereqSet = new Set(skill.prerequisiteSkillIds ?? []);
    const prereqOptions = siblings
      .filter((s) => s.id !== skill.id)
      .map((s) => ({
        id: s.id,
        slug: s.slug,
        title: s.title,
        selected: prereqSet.has(s.id),
      }));
    return {
      skill: {
        ...skill,
        tagsCsv: (skill.tags ?? []).join(', '),
        estimatedHoursNum: Number(skill.estimatedHours),
      },
      stack: skill.techStack,
      lessons,
      prereqOptions,
      hasPrereqOptions: prereqOptions.length > 0,
    };
  }

  async updateSkill(
    id: string,
    input: {
      title?: string;
      description?: string;
      orderHint?: number;
      estimatedHours?: number;
      tags?: string;
      prereqIds?: string[];
      isActive?: boolean;
    },
  ) {
    const skill = await this.skills.findOne({ where: { id } });
    if (!skill) throw new NotFoundException('Skill not found');
    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) throw new BadRequestException('Title required');
      skill.title = title;
    }
    if (input.description !== undefined) {
      skill.description = input.description.trim();
    }
    if (input.orderHint !== undefined && Number.isFinite(input.orderHint)) {
      skill.orderHint = input.orderHint;
    }
    if (
      input.estimatedHours !== undefined &&
      Number.isFinite(input.estimatedHours)
    ) {
      skill.estimatedHours = String(input.estimatedHours);
      skill.estimatedMasteryMinutes = Math.round(input.estimatedHours * 60);
    }
    if (input.tags !== undefined) skill.tags = parseCsv(input.tags);
    if (input.prereqIds !== undefined) {
      const allowed = await this.skills.find({
        where: { techStackId: skill.techStackId },
        select: { id: true },
      });
      const allowedSet = new Set(allowed.map((s) => s.id));
      skill.prerequisiteSkillIds = input.prereqIds.filter(
        (pid) => pid !== id && allowedSet.has(pid),
      );
    }
    if (input.isActive !== undefined) skill.isActive = input.isActive;
    return this.skills.save(skill);
  }

  async deleteSkill(id: string) {
    const skill = await this.skills.findOne({ where: { id } });
    if (!skill) throw new NotFoundException('Skill not found');
    const stackId = skill.techStackId;
    await this.dataSource.transaction(async (manager) => {
      await this.scrubSkillRefs(manager.getRepository(SkillNode), [id]);
      await this.scrubRecipeSkillIds(manager.getRepository(RoleRecipe), [id]);
      await manager.getRepository(SkillNode).remove(skill);
    });
    return { stackId };
  }

  async createLesson(
    skillId: string,
    input: {
      slug?: string;
      title: string;
      lessonType?: string;
      estimatedMinutes?: number;
      xpReward?: number;
      orderHint?: number;
      missionNameTemplate?: string;
      learningStyleTags?: string;
    },
  ) {
    const skill = await this.skills.findOne({ where: { id: skillId } });
    if (!skill) throw new NotFoundException('Skill not found');
    const title = input.title.trim();
    if (!title) throw new BadRequestException('Title required');
    const slug = slugify(input.slug?.trim() || title);
    if (!slug) throw new BadRequestException('Slug required');
    const clash = await this.lessons.findOne({
      where: { skillNodeId: skillId, slug },
    });
    if (clash) throw new BadRequestException(`Lesson slug "${slug}" exists`);

    const lessonType = (input.lessonType?.trim() || 'reading').toLowerCase();
    if (!LESSON_TYPES.includes(lessonType as (typeof LESSON_TYPES)[number])) {
      throw new BadRequestException(`Invalid lesson type "${lessonType}"`);
    }

    const missionNameTemplate = input.missionNameTemplate?.trim() || null;

    return this.lessons.save(
      this.lessons.create({
        skillNodeId: skillId,
        slug,
        title,
        missionNameTemplate,
        lessonType,
        estimatedMinutes: input.estimatedMinutes ?? 20,
        xpReward: input.xpReward ?? 20,
        orderHint: input.orderHint ?? 0,
        learningStyleTags: parseCsv(input.learningStyleTags),
        // Author via contentOutlineJson / catalog seed — no synth fallback.
        contentOutline: {},
        status: ContentPublicationStatus.Published,
        isActive: true,
      }),
    );
  }

  async getLesson(id: string) {
    const lesson = await this.lessons.findOne({
      where: { id },
      relations: { skillNode: { techStack: true } },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    return {
      lesson: {
        ...lesson,
        learningStyleTagsCsv: (lesson.learningStyleTags ?? []).join(', '),
        contentOutlineJson: JSON.stringify(lesson.contentOutline ?? {}, null, 2),
      },
      skill: lesson.skillNode,
      stack: lesson.skillNode.techStack,
      lessonTypes: this.lessonTypeChoices(lesson.lessonType),
    };
  }

  async updateLesson(
    id: string,
    input: {
      title?: string;
      lessonType?: string;
      estimatedMinutes?: number;
      xpReward?: number;
      orderHint?: number;
      missionNameTemplate?: string;
      learningStyleTags?: string;
      contentOutlineJson?: string;
      isActive?: boolean;
    },
  ) {
    const lesson = await this.lessons.findOne({ where: { id } });
    if (!lesson) throw new NotFoundException('Lesson not found');
    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) throw new BadRequestException('Title required');
      lesson.title = title;
    }
    if (input.lessonType !== undefined) {
      const lessonType = input.lessonType.trim().toLowerCase();
      if (!LESSON_TYPES.includes(lessonType as (typeof LESSON_TYPES)[number])) {
        throw new BadRequestException(`Invalid lesson type "${lessonType}"`);
      }
      lesson.lessonType = lessonType;
    }
    if (
      input.estimatedMinutes !== undefined &&
      Number.isFinite(input.estimatedMinutes)
    ) {
      lesson.estimatedMinutes = input.estimatedMinutes;
    }
    if (input.xpReward !== undefined && Number.isFinite(input.xpReward)) {
      lesson.xpReward = input.xpReward;
    }
    if (input.orderHint !== undefined && Number.isFinite(input.orderHint)) {
      lesson.orderHint = input.orderHint;
    }
    if (input.missionNameTemplate !== undefined) {
      lesson.missionNameTemplate =
        input.missionNameTemplate.trim() || null;
    }
    if (input.learningStyleTags !== undefined) {
      lesson.learningStyleTags = parseCsv(input.learningStyleTags);
    }
    if (input.contentOutlineJson !== undefined) {
      const raw = input.contentOutlineJson.trim();
      if (!raw) {
        lesson.contentOutline = {};
      } else {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new BadRequestException('contentOutline must be a JSON object');
          }
          lesson.contentOutline = parsed as Record<string, unknown>;
        } catch (e) {
          if (e instanceof BadRequestException) throw e;
          throw new BadRequestException('Invalid contentOutline JSON');
        }
      }
    }
    if (input.isActive !== undefined) lesson.isActive = input.isActive;
    return this.lessons.save(lesson);
  }

  async deleteLesson(id: string) {
    const lesson = await this.lessons.findOne({ where: { id } });
    if (!lesson) throw new NotFoundException('Lesson not found');
    const skillId = lesson.skillNodeId;
    await this.lessons.remove(lesson);
    return { skillId };
  }

  private async resolvePrereqSlugs(stackId: string, slugs: string[]) {
    if (!slugs.length) return [];
    const found = await this.skills.find({
      where: { techStackId: stackId, slug: In(slugs) },
      select: { id: true, slug: true },
    });
    const bySlug = new Map(found.map((s) => [s.slug, s.id]));
    return slugs.map((s) => bySlug.get(s)).filter((id): id is string => Boolean(id));
  }

  private async scrubSkillRefs(
    repo: Repository<SkillNode>,
    removeIds: string[],
  ) {
    const removeSet = new Set(removeIds);
    const all = await repo.find({
      select: { id: true, prerequisiteSkillIds: true },
    });
    for (const row of all) {
      const next = (row.prerequisiteSkillIds ?? []).filter(
        (id) => !removeSet.has(id),
      );
      if (next.length !== (row.prerequisiteSkillIds ?? []).length) {
        await repo.update(row.id, { prerequisiteSkillIds: next });
      }
    }
  }

  private async scrubRecipeSkillIds(
    repo: Repository<RoleRecipe>,
    removeIds: string[],
  ) {
    const removeSet = new Set(removeIds);
    const all = await repo.find();
    for (const recipe of all) {
      const required = (recipe.requiredSkillNodeIds ?? []).filter(
        (id) => !removeSet.has(id),
      );
      const optional = (recipe.optionalSkillNodeIds ?? []).filter(
        (id) => !removeSet.has(id),
      );
      if (
        required.length !== (recipe.requiredSkillNodeIds ?? []).length ||
        optional.length !== (recipe.optionalSkillNodeIds ?? []).length
      ) {
        recipe.requiredSkillNodeIds = required;
        recipe.optionalSkillNodeIds = optional;
        await repo.save(recipe);
      }
    }
  }

  /**
   * Import `*-learning-data.json` catalog pack (stacks/skills/lessons/recipes).
   * Creates missing rows; when overwrite=true also refreshes existing by slug.
   */
  async importCatalogJson(
    raw: Buffer | string,
    opts: { overwrite?: boolean } = {},
  ): Promise<CatalogImportStats> {
    const catalog = this.parseCatalogJson(raw);
    const overwrite = opts.overwrite !== false;

    const stats: CatalogImportStats = {
      resourcesAdded: 0,
      resourcesUpdated: 0,
      stacksAdded: 0,
      stacksUpdated: 0,
      skillsAdded: 0,
      skillsUpdated: 0,
      lessonsAdded: 0,
      lessonsUpdated: 0,
      recipesAdded: 0,
      recipesUpdated: 0,
    };

    await this.dataSource.transaction(async (manager) => {
      const resourceRepo = manager.getRepository(Resource);
      const stackRepo = manager.getRepository(TechStack);
      const skillRepo = manager.getRepository(SkillNode);
      const lessonRepo = manager.getRepository(LessonTemplate);
      const recipeRepo = manager.getRepository(RoleRecipe);
      const careerRepo = manager.getRepository(CareerRole);

      const resourceIdBySlug = new Map<string, string>();
      for (const existing of await resourceRepo.find()) {
        resourceIdBySlug.set(existing.slug, existing.id);
      }

      for (const res of catalog.resources) {
        const existingId = resourceIdBySlug.get(res.slug);
        if (!existingId) {
          const saved = await resourceRepo.save(
            resourceRepo.create({
              slug: res.slug,
              title: res.title,
              url: res.url,
              provider: res.provider,
              resourceType: res.resourceType,
              skillTags: res.skillTags ?? [],
              techStackSlugs: res.techStackSlugs ?? [],
              isActive: true,
              isFree: true,
            }),
          );
          resourceIdBySlug.set(saved.slug, saved.id);
          stats.resourcesAdded += 1;
          continue;
        }
        if (!overwrite) continue;
        await resourceRepo.update(existingId, {
          title: res.title,
          url: res.url,
          provider: res.provider,
          resourceType: res.resourceType,
          skillTags: res.skillTags ?? [],
          techStackSlugs: res.techStackSlugs ?? [],
          isActive: true,
        });
        stats.resourcesUpdated += 1;
      }

      const stackIdBySlug = new Map<string, string>();
      for (const existing of await stackRepo.find()) {
        stackIdBySlug.set(existing.slug, existing.id);
      }

      const skillIdByKey = new Map<string, string>();
      for (const existing of await skillRepo.find({
        relations: { techStack: true },
      })) {
        const stackSlug = existing.techStack?.slug;
        if (stackSlug) {
          skillIdByKey.set(`${stackSlug}:${existing.slug}`, existing.id);
        }
      }

      const lessonByKey = new Map<string, LessonTemplate>();
      for (const existing of await lessonRepo.find({
        relations: { skillNode: { techStack: true } },
      })) {
        const stackSlug = existing.skillNode?.techStack?.slug;
        const skillSlug = existing.skillNode?.slug;
        if (stackSlug && skillSlug) {
          lessonByKey.set(
            `${stackSlug}:${skillSlug}:${existing.slug}`,
            existing,
          );
        }
      }

      for (const stackSeed of catalog.stacks) {
        let stackId = stackIdBySlug.get(stackSeed.slug);
        if (!stackId) {
          const stack = await stackRepo.save(
            stackRepo.create({
              slug: stackSeed.slug,
              name: stackSeed.name,
              category: stackSeed.category,
              description: stackSeed.description,
              isActive: true,
            }),
          );
          stackId = stack.id;
          stackIdBySlug.set(stack.slug, stackId);
          stats.stacksAdded += 1;
        } else if (overwrite) {
          await stackRepo.update(stackId, {
            name: stackSeed.name,
            category: stackSeed.category,
            description: stackSeed.description,
            isActive: true,
          });
          stats.stacksUpdated += 1;
        }

        for (const skillSeed of stackSeed.skills) {
          const skillKey = `${stackSeed.slug}:${skillSeed.slug}`;
          let skillId = skillIdByKey.get(skillKey);
          if (!skillId) {
            const skill = await skillRepo.save(
              skillRepo.create({
                techStackId: stackId,
                slug: skillSeed.slug,
                title: skillSeed.title,
                description: skillSeed.description ?? '',
                orderHint: skillSeed.orderHint,
                estimatedHours: String(skillSeed.estimatedHours),
                estimatedMasteryMinutes: Math.round(
                  skillSeed.estimatedHours * 60,
                ),
                tags: skillSeed.tags ?? [],
                prerequisiteSkillIds: [],
                isActive: true,
              }),
            );
            skillId = skill.id;
            skillIdByKey.set(skillKey, skillId);
            stats.skillsAdded += 1;
          } else if (overwrite) {
            await skillRepo.update(skillId, {
              title: skillSeed.title,
              description: skillSeed.description ?? '',
              orderHint: skillSeed.orderHint,
              estimatedHours: String(skillSeed.estimatedHours),
              estimatedMasteryMinutes: Math.round(
                skillSeed.estimatedHours * 60,
              ),
              tags: skillSeed.tags ?? [],
              isActive: true,
            });
            stats.skillsUpdated += 1;
          }

          for (const lessonSeed of skillSeed.lessons ?? []) {
            const lessonKey = `${stackSeed.slug}:${skillSeed.slug}:${lessonSeed.slug}`;
            const contentOutline = resolveImportOutline(
              lessonSeed,
              skillSeed.slug,
            );
            const existingLesson = lessonByKey.get(lessonKey);
            if (!existingLesson) {
              const saved = await lessonRepo.save(
                lessonRepo.create({
                  skillNodeId: skillId,
                  slug: lessonSeed.slug,
                  title: lessonSeed.title,
                  missionNameTemplate: lessonSeed.missionNameTemplate ?? null,
                  lessonType: lessonSeed.lessonType,
                  estimatedMinutes: lessonSeed.estimatedMinutes,
                  xpReward: lessonSeed.xpReward,
                  learningStyleTags: lessonSeed.learningStyleTags ?? [],
                  orderHint: lessonSeed.orderHint,
                  defaultResourceId: lessonSeed.resourceSlug
                    ? (resourceIdBySlug.get(lessonSeed.resourceSlug) ?? null)
                    : null,
                  contentOutline:
                    contentOutline as unknown as Record<string, unknown>,
                  status: ContentPublicationStatus.Published,
                  isActive: true,
                }),
              );
              lessonByKey.set(lessonKey, saved);
              stats.lessonsAdded += 1;
            } else if (overwrite) {
              existingLesson.title = lessonSeed.title;
              existingLesson.missionNameTemplate =
                lessonSeed.missionNameTemplate ?? null;
              existingLesson.lessonType = lessonSeed.lessonType;
              existingLesson.estimatedMinutes = lessonSeed.estimatedMinutes;
              existingLesson.xpReward = lessonSeed.xpReward;
              existingLesson.learningStyleTags =
                lessonSeed.learningStyleTags ?? [];
              existingLesson.orderHint = lessonSeed.orderHint;
              existingLesson.defaultResourceId = lessonSeed.resourceSlug
                ? (resourceIdBySlug.get(lessonSeed.resourceSlug) ?? null)
                : null;
              existingLesson.contentOutline =
                contentOutline as unknown as Record<string, unknown>;
              existingLesson.status = ContentPublicationStatus.Published;
              existingLesson.isActive = true;
              await lessonRepo.save(existingLesson);
              stats.lessonsUpdated += 1;
            }
          }
        }
      }

      for (const stackSeed of catalog.stacks) {
        for (const skillSeed of stackSeed.skills) {
          if (!skillSeed.prereqSlugs?.length) continue;
          const skillId = skillIdByKey.get(
            `${stackSeed.slug}:${skillSeed.slug}`,
          );
          if (!skillId) continue;
          const prereqIds = skillSeed.prereqSlugs
            .map((ref) => {
              if (ref.includes(':')) return skillIdByKey.get(ref);
              return skillIdByKey.get(`${stackSeed.slug}:${ref}`);
            })
            .filter((id): id is string => Boolean(id));
          await skillRepo.update(skillId, { prerequisiteSkillIds: prereqIds });
        }
      }

      for (const recipe of catalog.recipes) {
        const requiredSkillNodeIds: string[] = [];
        const optionalSkillNodeIds: string[] = [];
        for (const phase of recipe.phases) {
          for (const stackSlug of phase.tech_stack_slugs) {
            for (const [key, id] of skillIdByKey) {
              if (!key.startsWith(`${stackSlug}:`)) continue;
              if (phase.required) requiredSkillNodeIds.push(id);
              else optionalSkillNodeIds.push(id);
            }
          }
        }

        let career = await careerRepo.findOne({
          where: { slug: recipe.targetRoleSlug },
        });
        if (!career) {
          career = await careerRepo.save(
            careerRepo.create({
              slug: recipe.targetRoleSlug,
              title: recipe.title.replace(/ Path$/, ''),
              description: recipe.summary,
              category: 'career',
              isActive: true,
            }),
          );
        } else if (overwrite) {
          await careerRepo.update(career.id, {
            title: recipe.title.replace(/ Path$/, ''),
            description: recipe.summary,
            isActive: true,
          });
        }

        const existingRecipe = await recipeRepo.findOne({
          where: { targetRoleSlug: recipe.targetRoleSlug },
        });
        if (!existingRecipe) {
          await recipeRepo.save(
            recipeRepo.create({
              careerRoleId: career.id,
              targetRoleSlug: recipe.targetRoleSlug,
              title: recipe.title,
              summary: recipe.summary,
              version: 1,
              defaultTimelineWeeks: recipe.defaultTimelineWeeks,
              stackPlan: { phases: recipe.phases },
              requiredSkillNodeIds: [...new Set(requiredSkillNodeIds)],
              optionalSkillNodeIds: [...new Set(optionalSkillNodeIds)],
              minimumAssessmentRules: {
                requireDiagnosticForSkip: true,
                minConfidenceForSkip: 'confident',
              },
              isActive: true,
            }),
          );
          stats.recipesAdded += 1;
        } else if (overwrite) {
          await recipeRepo.update(existingRecipe.id, {
            careerRoleId: career.id,
            title: recipe.title,
            summary: recipe.summary,
            defaultTimelineWeeks: recipe.defaultTimelineWeeks,
            stackPlan: { phases: recipe.phases },
            requiredSkillNodeIds: [...new Set(requiredSkillNodeIds)],
            optionalSkillNodeIds: [...new Set(optionalSkillNodeIds)],
            version: existingRecipe.version + 1,
            isActive: true,
          });
          stats.recipesUpdated += 1;
        }
      }
    });

    const roleSlugs = catalog.recipes.map((r) => r.targetRoleSlug);
    await this.roadmapSnapshots.invalidateRecipeCaches(
      roleSlugs.length ? roleSlugs : undefined,
    );

    return stats;
  }

  private parseCatalogJson(raw: Buffer | string): CatalogSeed {
    let parsed: unknown;
    try {
      const text =
        typeof raw === 'string' ? raw : raw.toString('utf8').replace(/^\uFEFF/, '');
      parsed = JSON.parse(text);
    } catch {
      throw new BadRequestException('Invalid JSON file');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException('JSON root must be an object');
    }
    const body = parsed as {
      resources?: SeedResource[];
      stacks?: SeedStack[];
      recipes?: SeedRecipe[];
    };
    if (!Array.isArray(body.stacks) || body.stacks.length === 0) {
      throw new BadRequestException('JSON must include non-empty stacks[]');
    }
    for (const stack of body.stacks) {
      if (!stack?.slug || !stack?.name) {
        throw new BadRequestException('Each stack needs slug + name');
      }
      if (!Array.isArray(stack.skills)) {
        throw new BadRequestException(`Stack "${stack.slug}" missing skills[]`);
      }
    }
    return {
      resources: Array.isArray(body.resources) ? body.resources : [],
      stacks: body.stacks,
      recipes: Array.isArray(body.recipes) ? body.recipes : [],
    };
  }
}
