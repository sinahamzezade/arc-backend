import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { CareerRole } from '../content-pool/entities/career-role.entity';
import { ContentPublicationStatus } from '../content-pool/content-pool.constants';
import { AssessmentTemplate } from './entities/assessment-template.entity';
import { LessonTemplate } from './entities/lesson-template.entity';
import { Resource } from './entities/resource.entity';
import { RoleRecipe } from './entities/role-recipe.entity';
import { SkillNode } from './entities/skill-node.entity';
import { TechStack } from './entities/tech-stack.entity';
import { CATALOG_SEED } from './seeds/catalog.seed';
import { inappContentToPlayOutline, isCompletionAckPractice } from './seeds/inapp-content.mapper';
import { outlineForTemplateSeed } from '../lessons/play-outline.factory';
import { isPlayOutline } from '../lessons/lesson-play.types';
import { Lesson } from '../roadmaps/entities/lesson.entity';

function resolveSeedOutline(lessonSeed: {
  slug: string;
  title: string;
  missionNameTemplate?: string;
  lessonType: string;
  content?: unknown;
}) {
  if (lessonSeed.content) {
    return inappContentToPlayOutline({
      title: lessonSeed.title,
      missionNameTemplate: lessonSeed.missionNameTemplate,
      lessonType: lessonSeed.lessonType,
      content: lessonSeed.content as never,
    });
  }
  return outlineForTemplateSeed({
    slug: lessonSeed.slug,
    title: lessonSeed.title,
    missionNameTemplate: lessonSeed.missionNameTemplate,
    lessonType: lessonSeed.lessonType,
  });
}

export type LoadedSkillNode = SkillNode & {
  lessonTemplates: LessonTemplate[];
  techStack: TechStack;
};

export type RecipeSubgraph = {
  recipe: RoleRecipe;
  stacksBySlug: Map<string, TechStack>;
  skillsByStackSlug: Map<string, LoadedSkillNode[]>;
  resourcesById: Map<string, Resource>;
};

@Injectable()
export class SkillGraphService implements OnModuleInit {
  private readonly logger = new Logger(SkillGraphService.name);

  constructor(
    @InjectRepository(TechStack)
    private readonly stacksRepo: Repository<TechStack>,
    @InjectRepository(SkillNode)
    private readonly skillsRepo: Repository<SkillNode>,
    @InjectRepository(LessonTemplate)
    private readonly lessonsRepo: Repository<LessonTemplate>,
    @InjectRepository(Resource)
    private readonly resourcesRepo: Repository<Resource>,
    @InjectRepository(RoleRecipe)
    private readonly recipesRepo: Repository<RoleRecipe>,
    @InjectRepository(AssessmentTemplate)
    private readonly assessmentsRepo: Repository<AssessmentTemplate>,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.ensureSeeded();
  }

  async findRecipeByRole(targetRoleSlug: string): Promise<RoleRecipe | null> {
    return this.recipesRepo.findOne({
      where: { targetRoleSlug, isActive: true },
    });
  }

  /** First active recipe matching any role in order (multi-goal goals). */
  async findFirstRecipeForRoles(
    targetRoleSlugs: string[],
  ): Promise<RoleRecipe | null> {
    for (const slug of targetRoleSlugs) {
      if (!slug) continue;
      const recipe = await this.findRecipeByRole(slug);
      if (recipe) return recipe;
    }
    return null;
  }

  async loadSubgraphForRecipe(recipe: RoleRecipe): Promise<RecipeSubgraph> {
    const slugs = [
      ...new Set(
        recipe.stackPlan.phases.flatMap((p) => p.tech_stack_slugs ?? []),
      ),
    ];

    const stacks = await this.stacksRepo.find({
      where: { slug: In(slugs), isActive: true },
    });
    const stacksBySlug = new Map(stacks.map((s) => [s.slug, s]));

    const stackIds = stacks.map((s) => s.id);
    const skills =
      stackIds.length === 0
        ? []
        : await this.skillsRepo.find({
            where: { techStackId: In(stackIds), isActive: true },
            relations: { lessonTemplates: true, techStack: true },
            order: { orderHint: 'ASC' },
          });

    const skillsByStackSlug = new Map<string, LoadedSkillNode[]>();
    for (const skill of skills) {
      const activeLessons = (skill.lessonTemplates ?? [])
        .filter(
          (l) =>
            l.isActive &&
            l.status !== ContentPublicationStatus.Retired &&
            l.status !== ContentPublicationStatus.Blocked,
        )
        .sort((a, b) => a.orderHint - b.orderHint);
      const loaded = {
        ...skill,
        lessonTemplates: activeLessons,
      } as LoadedSkillNode;
      const list = skillsByStackSlug.get(skill.techStack.slug) ?? [];
      list.push(loaded);
      skillsByStackSlug.set(skill.techStack.slug, list);
    }

    const resourceIds = [
      ...new Set(
        skills
          .flatMap((s) => s.lessonTemplates ?? [])
          .map((l) => l.defaultResourceId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const resources =
      resourceIds.length === 0
        ? []
        : await this.resourcesRepo.find({
            where: { id: In(resourceIds), isActive: true },
          });
    const resourcesById = new Map(resources.map((r) => [r.id, r]));

    return { recipe, stacksBySlug, skillsByStackSlug, resourcesById };
  }

  private async ensureSeeded() {
    if (process.env.SKILL_GRAPH_RESET_ON_BOOT === 'true') {
      this.logger.warn(
        'SKILL_GRAPH_RESET_ON_BOOT=true — wiping learning catalog + user paths',
      );
      await this.wipeLearningData();
    }

    const existing = await this.recipesRepo.count();
    if (existing === 0) {
      this.logger.log('Seeding skill graph catalog…');
      await this.seedCatalog(CATALOG_SEED);
      return;
    }

    this.logger.log(
      'Skill graph catalog already seeded — upserting missing packs',
    );
    await this.upsertMissingCatalog(CATALOG_SEED);
    await this.backfillEmptyOutlines();
    await this.refreshCompletionAckOutlines();
    await this.backfillCareerRoles();
  }

  /** Wipe user roadmaps/weeks + skill-graph pool so ensureSeeded can re-import. */
  async wipeLearningData() {
    await this.dataSource.query(`
      TRUNCATE TABLE
        lesson_completion_results,
        lesson_attempts,
        lesson_progress,
        weekly_plan_events,
        weekly_tasks,
        weekly_plans,
        reminder_plans,
        schedule_changes,
        schedule_slots,
        pace_snapshots,
        course_schedules,
        learning_commitments,
        lessons,
        milestones,
        roadmap_phases,
        roadmap_generation_jobs,
        roadmaps,
        lesson_versions,
        assessment_templates,
        question_versions,
        question_templates,
        skill_prerequisites,
        lesson_templates,
        skill_nodes,
        role_recipes,
        module_templates,
        course_templates,
        resources,
        tech_stacks,
        career_roles
      RESTART IDENTITY CASCADE
    `);
    this.logger.warn('Learning catalog + user path tables truncated');
  }

  private async seedCatalog(catalog: typeof CATALOG_SEED) {
    await this.dataSource.transaction(async (manager) => {
      const resourceIdBySlug = new Map<string, string>();

      for (const res of catalog.resources) {
        const row = manager.create(Resource, {
          slug: res.slug,
          title: res.title,
          url: res.url,
          provider: res.provider,
          resourceType: res.resourceType,
          skillTags: res.skillTags ?? [],
          techStackSlugs: res.techStackSlugs ?? [],
          isActive: true,
          isFree: true,
        });
        const saved = await manager.save(row);
        resourceIdBySlug.set(saved.slug, saved.id);
      }

      const skillIdByKey = new Map<string, string>();

      for (const stackSeed of catalog.stacks) {
        const stack = await manager.save(
          manager.create(TechStack, {
            slug: stackSeed.slug,
            name: stackSeed.name,
            category: stackSeed.category,
            description: stackSeed.description,
            isActive: true,
          }),
        );

        for (const skillSeed of stackSeed.skills) {
          const skill = await manager.save(
            manager.create(SkillNode, {
              techStackId: stack.id,
              slug: skillSeed.slug,
              title: skillSeed.title,
              description: skillSeed.description ?? '',
              orderHint: skillSeed.orderHint,
              estimatedHours: String(skillSeed.estimatedHours),
              estimatedMasteryMinutes: Math.round(
                skillSeed.estimatedHours * 60,
              ),
              tags: skillSeed.tags,
              prerequisiteSkillIds: [],
              isActive: true,
            }),
          );
          skillIdByKey.set(`${stack.slug}:${skill.slug}`, skill.id);

          for (const lessonSeed of skillSeed.lessons) {
            const contentOutline = resolveSeedOutline(lessonSeed);
            await manager.save(
              manager.create(LessonTemplate, {
                skillNodeId: skill.id,
                slug: lessonSeed.slug,
                title: lessonSeed.title,
                missionNameTemplate: lessonSeed.missionNameTemplate ?? null,
                lessonType: lessonSeed.lessonType,
                estimatedMinutes: lessonSeed.estimatedMinutes,
                xpReward: lessonSeed.xpReward,
                learningStyleTags: lessonSeed.learningStyleTags,
                orderHint: lessonSeed.orderHint,
                defaultResourceId: lessonSeed.resourceSlug
                  ? (resourceIdBySlug.get(lessonSeed.resourceSlug) ?? null)
                  : null,
                contentOutline,
                status: ContentPublicationStatus.Published,
                isActive: true,
              }),
            );
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
          await manager.update(SkillNode, skillId, {
            prerequisiteSkillIds: prereqIds,
          });
        }
      }

      for (const recipe of catalog.recipes) {
        const career = await manager.save(
          manager.create(CareerRole, {
            slug: recipe.targetRoleSlug,
            title: recipe.title.replace(/ Path$/, ''),
            description: recipe.summary,
            category: 'career',
            isActive: true,
          }),
        );

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

        await manager.save(
          manager.create(RoleRecipe, {
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
      }
    });

    this.logger.log(
      `Skill graph catalog seeded (${catalog.stacks.length} stacks, ${catalog.recipes.length} recipes)`,
    );
  }

  /** Insert only missing resources/stacks/skills/lessons/recipes (keep existing). */
  private async upsertMissingCatalog(catalog: typeof CATALOG_SEED) {
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

      let addedResources = 0;
      for (const res of catalog.resources) {
        if (resourceIdBySlug.has(res.slug)) continue;
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
        addedResources += 1;
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
        if (stackSlug)
          skillIdByKey.set(`${stackSlug}:${existing.slug}`, existing.id);
      }

      const existingLessonSlugs = new Set(
        (await lessonRepo.find({ select: { slug: true } })).map((l) => l.slug),
      );

      let addedStacks = 0;
      let addedSkills = 0;
      let addedLessons = 0;

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
          addedStacks += 1;
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
                tags: skillSeed.tags,
                prerequisiteSkillIds: [],
                isActive: true,
              }),
            );
            skillId = skill.id;
            skillIdByKey.set(skillKey, skillId);
            addedSkills += 1;
          }

          for (const lessonSeed of skillSeed.lessons) {
            if (existingLessonSlugs.has(lessonSeed.slug)) continue;
            const contentOutline = resolveSeedOutline(lessonSeed);
            await lessonRepo.save(
              lessonRepo.create({
                skillNodeId: skillId,
                slug: lessonSeed.slug,
                title: lessonSeed.title,
                missionNameTemplate: lessonSeed.missionNameTemplate ?? null,
                lessonType: lessonSeed.lessonType,
                estimatedMinutes: lessonSeed.estimatedMinutes,
                xpReward: lessonSeed.xpReward,
                learningStyleTags: lessonSeed.learningStyleTags,
                orderHint: lessonSeed.orderHint,
                defaultResourceId: lessonSeed.resourceSlug
                  ? (resourceIdBySlug.get(lessonSeed.resourceSlug) ?? null)
                  : null,
                contentOutline,
                status: ContentPublicationStatus.Published,
                isActive: true,
              }),
            );
            existingLessonSlugs.add(lessonSeed.slug);
            addedLessons += 1;
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

      const existingRecipeSlugs = new Set(
        (await recipeRepo.find()).map((r) => r.targetRoleSlug),
      );
      let addedRecipes = 0;

      for (const recipe of catalog.recipes) {
        if (existingRecipeSlugs.has(recipe.targetRoleSlug)) continue;

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
        }

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
        addedRecipes += 1;
      }

      this.logger.log(
        `Catalog upsert: +${addedResources} resources, +${addedStacks} stacks, +${addedSkills} skills, +${addedLessons} lessons, +${addedRecipes} recipes`,
      );
    });
  }

  private async backfillEmptyOutlines() {
    const templates = await this.lessonsRepo.find();
    let updated = 0;
    for (const template of templates) {
      if (isPlayOutline(template.contentOutline)) continue;
      template.contentOutline = outlineForTemplateSeed({
        slug: template.slug,
        title: template.title,
        missionNameTemplate: template.missionNameTemplate,
        lessonType: template.lessonType,
      });
      await this.lessonsRepo.save(template);
      updated += 1;
    }
    if (updated > 0) {
      this.logger.log(
        `Backfilled content_outline on ${updated} lesson templates`,
      );
    }
  }

  /**
   * Replace old "I completed this step / Come back later" practice stubs
   * with knowledge checks from the catalog seed (templates + live lessons).
   */
  private async refreshCompletionAckOutlines() {
    const bySlug = new Map<
      string,
      ReturnType<typeof resolveSeedOutline>
    >();
    for (const stack of CATALOG_SEED.stacks) {
      for (const skill of stack.skills) {
        for (const lesson of skill.lessons) {
          bySlug.set(lesson.slug, resolveSeedOutline(lesson));
        }
      }
    }

    let templatesUpdated = 0;
    const templates = await this.lessonsRepo.find();
    for (const template of templates) {
      const outline = isPlayOutline(template.contentOutline)
        ? template.contentOutline
        : null;
      if (!outline || !isCompletionAckPractice(outline.practice)) continue;
      const fresh = bySlug.get(template.slug);
      if (!fresh || !isPlayOutline(fresh)) continue;
      if (isCompletionAckPractice(fresh.practice)) continue;
      template.contentOutline = fresh as unknown as Record<string, unknown>;
      await this.lessonsRepo.save(template);
      templatesUpdated += 1;
    }

    let lessonsUpdated = 0;
    const lessonRepo = this.dataSource.getRepository(Lesson);
    const templatesById = new Map(templates.map((t) => [t.id, t]));
    const lessons = await lessonRepo.find();
    for (const lesson of lessons) {
      if (!isPlayOutline(lesson.playContent)) continue;
      if (!isCompletionAckPractice(lesson.playContent.practice)) continue;

      let outline: ReturnType<typeof resolveSeedOutline> | null = null;
      const tpl = lesson.lessonTemplateId
        ? templatesById.get(lesson.lessonTemplateId)
        : null;
      if (tpl && isPlayOutline(tpl.contentOutline)) {
        outline = tpl.contentOutline;
      }
      if (
        (!outline || isCompletionAckPractice(outline.practice)) &&
        tpl?.slug
      ) {
        const fromSeed = bySlug.get(tpl.slug);
        if (fromSeed && isPlayOutline(fromSeed)) outline = fromSeed;
      }
      if (!outline || isCompletionAckPractice(outline.practice)) continue;
      lesson.playContent = outline as unknown as Record<string, unknown>;
      await lessonRepo.save(lesson);
      lessonsUpdated += 1;
    }

    if (templatesUpdated || lessonsUpdated) {
      this.logger.log(
        `Refreshed completion-ack practice: ${templatesUpdated} templates, ${lessonsUpdated} lessons`,
      );
    }
  }

  private async backfillCareerRoles() {
    const recipes = await this.recipesRepo.find();
    const careerRepo = this.dataSource.getRepository(CareerRole);
    for (const recipe of recipes) {
      if (recipe.careerRoleId) continue;
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
      }
      recipe.careerRoleId = career.id;
      await this.recipesRepo.save(recipe);
    }
  }
}
