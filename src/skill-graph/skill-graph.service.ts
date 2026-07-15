import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ContentPublicationStatus } from '../content-pool/content-pool.constants';
import { AssessmentTemplate } from './entities/assessment-template.entity';
import { LessonTemplate } from './entities/lesson-template.entity';
import { Resource } from './entities/resource.entity';
import { RoleRecipe } from './entities/role-recipe.entity';
import { SkillNode } from './entities/skill-node.entity';
import { TechStack } from './entities/tech-stack.entity';

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
    // Curriculum source of truth is now flattened units (UnitsCatalogService).
    // Legacy LessonTemplate/SkillNode seeding is disabled.
    if (process.env.SKILL_GRAPH_RESET_ON_BOOT === 'true') {
      this.logger.warn(
        'SKILL_GRAPH_RESET_ON_BOOT=true — wiping learning catalog + user paths',
      );
      await this.wipeLearningData();
    }
    this.logger.log(
      'Skill-graph tree seed skipped — units pool owns curriculum',
    );
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
        learner_skill_estimates,
        learner_profile_snapshots,
        questionnaire_responses,
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
        career_roles,
        units,
        skills
      RESTART IDENTITY CASCADE
    `);
    this.logger.warn('Learning catalog + user path tables truncated');
  }
}
