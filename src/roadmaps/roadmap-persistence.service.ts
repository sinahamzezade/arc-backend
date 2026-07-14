import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { isPlayOutline } from '../lessons/lesson-play.types';
import { Goal } from '../goals/entities/goal.entity';
import { TechStack } from '../skill-graph/entities/tech-stack.entity';
import { SkillNode } from '../skill-graph/entities/skill-node.entity';
import { LessonTemplate } from '../skill-graph/entities/lesson-template.entity';
import { Lesson, LessonStatus } from './entities/lesson.entity';
import { Milestone } from './entities/milestone.entity';
import { Roadmap, RoadmapStatus } from './entities/roadmap.entity';
import { RoadmapPhase } from './entities/roadmap-phase.entity';
import type {
  RoadmapPlanDto,
  SelectedPhaseDto,
} from './dto/roadmap-engine.types';

@Injectable()
export class RoadmapPersistenceService {
  private readonly logger = new Logger(RoadmapPersistenceService.name);

  constructor(private readonly dataSource: DataSource) {}

  async persistPlan(
    goal: Goal,
    plan: RoadmapPlanDto,
    meta: Record<string, unknown> = {},
  ): Promise<Roadmap> {
    return this.dataSource.transaction(async (manager) => {
      await manager.update(
        Roadmap,
        { goalId: goal.id, status: RoadmapStatus.Ready },
        { status: RoadmapStatus.Archived },
      );

      const roadmap = await manager.save(
        manager.create(Roadmap, {
          userId: goal.userId,
          goalId: goal.id,
          title: plan.title,
          description: plan.description,
          primaryRoleSlug: plan.primary_role_slug,
          timelineWeeks: plan.timeline_weeks,
          weeklyHoursTarget: String(plan.weekly_hours_target),
          status: RoadmapStatus.Ready,
          progressPercent: '0',
          generatedByPromptVersion: `roadmap_engine_v${plan.engine_version}`,
          generationMeta: {
            ...meta,
            engineVersion: plan.engine_version,
            seed: plan.seed,
            contentVersion: plan.content_version,
            recipeId: plan.recipe_id,
            skippedKnown: plan.skipped_known,
            explanations: plan.explanations,
            scheduleMeta: plan.schedule_meta,
            estimatedWeeks: plan.estimated_weeks,
            estimatedCompletionDate: plan.estimated_completion_date,
          },
        }),
      );

      let firstPhaseId: string | null = null;

      for (const planned of plan.phases) {
        // Skip empty special weeks without milestones for Path UI
        if (
          planned.week_type !== 'learning' &&
          (!planned.milestones || planned.milestones.length === 0)
        ) {
          continue;
        }
        const phase = await this.savePhase(manager, roadmap.id, planned);
        if (firstPhaseId === null) firstPhaseId = phase.id;
      }

      roadmap.currentPhaseId = firstPhaseId;
      return manager.save(roadmap);
    });
  }

  /** Atomic active pointer swap: archive old, ensure new is ready. */
  async swapActiveRoadmap(oldId: string, newId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const neu = await manager.findOne(Roadmap, { where: { id: newId } });
      if (!neu || neu.status !== RoadmapStatus.Ready) {
        throw new Error(`New roadmap ${newId} not ready for swap`);
      }
      if (oldId) {
        await manager.update(
          Roadmap,
          { id: oldId },
          { status: RoadmapStatus.Archived },
        );
      }
      // Ensure no other ready roadmaps for same user/goal
      await manager
        .createQueryBuilder()
        .update(Roadmap)
        .set({ status: RoadmapStatus.Archived })
        .where('user_id = :userId', { userId: neu.userId })
        .andWhere('goal_id = :goalId', { goalId: neu.goalId })
        .andWhere('id != :newId', { newId })
        .andWhere('status = :ready', { ready: RoadmapStatus.Ready })
        .execute();
    });
    this.logger.log(`Swapped active roadmap ${oldId} → ${newId}`);
  }

  private async resolveTechStackRef(
    manager: EntityManager,
    techStackId: string | null | undefined,
    techStackSlug: string | null | undefined,
  ): Promise<{ id: string | null; slug: string | null }> {
    const stackRepo = manager.getRepository(TechStack);
    if (techStackId) {
      const byId = await stackRepo.findOne({ where: { id: techStackId } });
      if (byId) return { id: byId.id, slug: byId.slug };
    }
    if (techStackSlug) {
      const bySlug = await stackRepo.findOne({
        where: { slug: techStackSlug },
      });
      if (bySlug) return { id: bySlug.id, slug: bySlug.slug };
    }
    if (techStackId || techStackSlug) {
      this.logger.warn(
        `Dropping stale tech_stack ref id=${techStackId ?? '-'} slug=${techStackSlug ?? '-'}`,
      );
    }
    return { id: null, slug: techStackSlug ?? null };
  }

  private async savePhase(
    manager: EntityManager,
    roadmapId: string,
    planned: SelectedPhaseDto,
  ): Promise<RoadmapPhase> {
    const stack = await this.resolveTechStackRef(
      manager,
      planned.tech_stack_id,
      planned.tech_stack_slug,
    );
    const phase = await manager.save(
      manager.create(RoadmapPhase, {
        roadmapId,
        techStackId: stack.id,
        techStackSlug: stack.slug,
        title: planned.title,
        orderIndex: planned.order_index,
        locked: planned.locked,
      }),
    );

    for (let mi = 0; mi < planned.milestones.length; mi++) {
      const pm = planned.milestones[mi]!;
      let skillNodeId = pm.skill_node_id || null;
      if (skillNodeId) {
        const skillOk = await manager.getRepository(SkillNode).exists({
          where: { id: skillNodeId },
        });
        if (!skillOk) {
          this.logger.warn(`Dropping stale skill_node_id=${skillNodeId}`);
          skillNodeId = null;
        }
      }
      const milestone = await manager.save(
        manager.create(Milestone, {
          phaseId: phase.id,
          skillNodeId,
          title: pm.title,
          type: pm.type,
          orderIndex: pm.order_index ?? mi,
          xpReward: pm.xp_reward,
        }),
      );

      for (let li = 0; li < pm.lessons.length; li++) {
        const pl = pm.lessons[li]!;
        const outline = isPlayOutline(pl.content_outline)
          ? pl.content_outline
          : null;
        let lessonTemplateId = pl.source_template_id || null;
        if (lessonTemplateId) {
          const tplOk = await manager.getRepository(LessonTemplate).exists({
            where: { id: lessonTemplateId },
          });
          if (!tplOk) {
            this.logger.warn(
              `Dropping stale lesson_template_id=${lessonTemplateId}`,
            );
            lessonTemplateId = null;
          }
        }
        await manager.save(
          manager.create(Lesson, {
            milestoneId: milestone.id,
            lessonTemplateId,
            title: pl.title,
            missionName: pl.mission_name,
            lessonType: pl.lesson_type,
            estimatedMinutes: pl.estimated_minutes,
            difficulty: pl.difficulty,
            xpReward: pl.xp_reward,
            orderIndex: li,
            resourceId: pl.resource_id,
            status:
              pl.status === 'available'
                ? LessonStatus.Available
                : pl.status === 'completed'
                  ? LessonStatus.Completed
                  : LessonStatus.Locked,
            playContent: outline,
            sourceVersionId: pl.source_version_id,
            rewardClassSnapshot: pl.reward_class ?? 'standard',
            materializedWindow: null,
            objective:
              outline && typeof outline === 'object' && 'objective' in outline
                ? String((outline as { objective: string }).objective)
                : null,
          }),
        );
      }
    }

    return phase;
  }
}
