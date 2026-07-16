import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { XP_GATES } from '../gamification/reward-calculator.constants';
import { Wallet } from '../gamification/entities/wallet.entity';
import { Lesson, LessonStatus } from '../roadmaps/entities/lesson.entity';
import { Milestone } from '../roadmaps/entities/milestone.entity';
import { Roadmap } from '../roadmaps/entities/roadmap.entity';
import { RoadmapPhase } from '../roadmaps/entities/roadmap-phase.entity';
import { RoadmapTreeLoader } from '../roadmaps/roadmap-tree.loader';
import { RoadmapCacheService } from '../roadmaps/roadmap-cache.service';
import {
  LessonProgress,
  LessonProgressStatus,
} from '../roadmaps/entities/lesson-progress.entity';

@Injectable()
export class LessonUnlockService {
  constructor(
    private readonly treeLoader: RoadmapTreeLoader,
    private readonly roadmapCache: RoadmapCacheService,
  ) {}

  /**
   * Mark lesson completed, unlock next locked lesson in roadmap order.
   * XP gate is soft (flag only) — never blocks starting the next lesson.
   * Weekly seal / pace-ahead must not stall Path progress.
   */
  async afterComplete(
    manager: EntityManager,
    userId: string,
    completedLesson: Lesson,
  ): Promise<{
    unlockedLessonIds: string[];
    progressPercent: number;
    xpGateBlocked?: boolean;
  }> {
    completedLesson.status = LessonStatus.Completed;
    await manager.getRepository(Lesson).save(completedLesson);

    const roadmap = await this.loadRoadmapForLesson(manager, completedLesson);
    if (!roadmap) {
      return { unlockedLessonIds: [], progressPercent: 0 };
    }

    const ordered = this.flattenLessons(roadmap);
    const idx = ordered.findIndex((l) => l.id === completedLesson.id);
    const current = idx >= 0 ? ordered[idx] : completedLesson;
    const unlockedLessonIds: string[] = [];
    let xpGateBlocked = false;

    if (idx >= 0 && idx < ordered.length - 1) {
      const next = ordered[idx + 1];
      if (next.status === LessonStatus.Locked) {
        const currentPhaseId = current.milestone?.phase?.id;
        const nextPhase = next.milestone?.phase;
        const crossingPhase =
          Boolean(nextPhase) &&
          Boolean(currentPhaseId) &&
          nextPhase!.id !== currentPhaseId;

        if (crossingPhase && nextPhase) {
          const phases = [...(roadmap.phases ?? [])].sort(
            (a, b) => a.orderIndex - b.orderIndex,
          );
          const phaseIdx = phases.findIndex((p) => p.id === nextPhase.id);
          const gate = XP_GATES[Math.min(phaseIdx, XP_GATES.length - 1)];
          const wallet = await manager.getRepository(Wallet).findOne({
            where: { userId },
          });
          const xp = wallet?.lifetimeXp ?? 0;
          // Soft gate only — still unlock so week-goal / ahead users can continue.
          if (gate && xp < gate.minXp) {
            xpGateBlocked = true;
          }
        }

        next.status = LessonStatus.Available;
        await manager.getRepository(Lesson).save(next);
        unlockedLessonIds.push(next.id);
      }
    }

    if (unlockedLessonIds.length > 0) {
      const unlocked = ordered.find((l) => l.id === unlockedLessonIds[0]);
      if (unlocked?.milestone?.phase && unlocked.milestone.phase.locked) {
        unlocked.milestone.phase.locked = false;
        await manager.getRepository(RoadmapPhase).save(unlocked.milestone.phase);
      }
    }

    const progressRepo = manager.getRepository(LessonProgress);
    const completedCount = await progressRepo.count({
      where: { userId, status: LessonProgressStatus.Completed },
    });
    const total = ordered.length || 1;
    const completedFromRows = ordered.filter(
      (l) => l.status === LessonStatus.Completed || l.id === completedLesson.id,
    ).length;
    const done = Math.max(completedCount, completedFromRows);
    const progressPercent = Math.round((done / total) * 10000) / 100;

    roadmap.progressPercent = String(progressPercent);
    await manager.getRepository(Roadmap).save(roadmap);

    await this.roadmapCache.invalidateRoadmap(roadmap.id, userId);

    return { unlockedLessonIds, progressPercent, xpGateBlocked };
  }

  async pathPercentile(
    manager: EntityManager,
    lesson: Lesson,
  ): Promise<number> {
    const roadmap = await this.loadRoadmapForLesson(manager, lesson);
    if (!roadmap) return 40;
    return this.percentileInRoadmap(roadmap, lesson.id);
  }

  /** Sync helper when roadmap tree already loaded on the lesson. */
  percentileInRoadmap(roadmap: Roadmap, lessonId: string): number {
    const ordered = this.flattenLessons(roadmap);
    if (!ordered.length) return 40;
    const idx = ordered.findIndex((l) => l.id === lessonId);
    if (idx < 0) return 40;
    return Math.round(((idx + 1) / ordered.length) * 100);
  }

  private async loadRoadmapForLesson(
    manager: EntityManager,
    lesson: Lesson,
  ): Promise<Roadmap | null> {
    const withRoadmap = await manager.getRepository(Lesson).findOne({
      where: { id: lesson.id },
      relations: {
        milestone: {
          phase: true,
        },
      },
    });
    const roadmapId = withRoadmap?.milestone?.phase?.roadmapId;
    if (!roadmapId) return null;
    return this.treeLoader.loadRoadmapTree(roadmapId);
  }

  private flattenLessons(roadmap: Roadmap): Lesson[] {
    const phases = [...(roadmap.phases ?? [])].sort(
      (a, b) => a.orderIndex - b.orderIndex,
    );
    const out: Lesson[] = [];
    for (const phase of phases) {
      const milestones = [...(phase.milestones ?? [])].sort(
        (a, b) => a.orderIndex - b.orderIndex,
      );
      for (const milestone of milestones) {
        const lessons = [...(milestone.lessons ?? [])].sort(
          (a, b) => a.orderIndex - b.orderIndex,
        );
        for (const lesson of lessons) {
          (lesson as Lesson & { milestone?: Milestone }).milestone = milestone;
          if (!milestone.phase) {
            (milestone as Milestone & { phase?: RoadmapPhase }).phase = phase;
          }
          out.push(lesson);
        }
      }
    }
    return out;
  }
}
