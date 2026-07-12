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
    const existing = await this.recipesRepo.count();
    if (existing > 0) {
      this.logger.log('Skill graph catalog already seeded');
      await this.backfillEmptyOutlines();
      await this.backfillCareerRoles();
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
              estimatedMasteryMinutes: Math.round(skillSeed.estimatedHours * 60),
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
                status: ContentPublicationStatus.Published,
                isActive: true,
              }),
            );
          }
        }
      }

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

    this.logger.log('Skill graph catalog seeded');
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
      this.logger.log(`Backfilled content_outline on ${updated} lesson templates`);
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
