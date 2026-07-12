import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AssessmentTemplate } from './entities/assessment-template.entity';
import { LessonTemplate } from './entities/lesson-template.entity';
import { Resource } from './entities/resource.entity';
import { RoleRecipe } from './entities/role-recipe.entity';
import { SkillNode } from './entities/skill-node.entity';
import { TechStack } from './entities/tech-stack.entity';
import { CATALOG_SEED } from './seeds/catalog.seed';
import { outlineForTemplateSeed } from '../lessons/play-outline.factory';
import { isPlayOutline } from '../lessons/lesson-play.types';

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
        .filter((l) => l.isActive)
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
    const existing = await this.recipesRepo.count();
    if (existing > 0) {
      this.logger.log('Skill graph catalog already seeded');
      await this.backfillEmptyOutlines();
      return;
    }

    this.logger.log('Seeding skill graph catalog…');
    await this.dataSource.transaction(async (manager) => {
      const resourceIdBySlug = new Map<string, string>();

      for (const res of CATALOG_SEED.resources) {
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

      for (const stackSeed of CATALOG_SEED.stacks) {
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
              tags: skillSeed.tags,
              prerequisiteSkillIds: [],
              isActive: true,
            }),
          );
          skillIdByKey.set(`${stack.slug}:${skill.slug}`, skill.id);

          for (const lessonSeed of skillSeed.lessons) {
            const contentOutline = outlineForTemplateSeed({
              slug: lessonSeed.slug,
              title: lessonSeed.title,
              missionNameTemplate: lessonSeed.missionNameTemplate,
              lessonType: lessonSeed.lessonType,
            });
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
                isActive: true,
              }),
            );
          }
        }
      }

      // Resolve prereqs (slug refs → ids)
      for (const stackSeed of CATALOG_SEED.stacks) {
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

      for (const recipe of CATALOG_SEED.recipes) {
        await manager.save(
          manager.create(RoleRecipe, {
            targetRoleSlug: recipe.targetRoleSlug,
            title: recipe.title,
            summary: recipe.summary,
            defaultTimelineWeeks: recipe.defaultTimelineWeeks,
            stackPlan: { phases: recipe.phases },
            isActive: true,
          }),
        );
      }
    });

    this.logger.log('Skill graph catalog seeded');
  }

  /** Fill content_outline for templates created before play payloads existed. */
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
      this.logger.log(`Backfilled content_outline on ${updated} lesson templates`);
    }
  }
}
