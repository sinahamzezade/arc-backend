import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Lesson, LessonStatus } from '../roadmaps/entities/lesson.entity';
import { Milestone } from '../roadmaps/entities/milestone.entity';
import { Roadmap } from '../roadmaps/entities/roadmap.entity';
import { RoadmapPhase } from '../roadmaps/entities/roadmap-phase.entity';
import {
  LessonProgress,
  LessonProgressStatus,
} from '../roadmaps/entities/lesson-progress.entity';

@Injectable()
export class LessonUnlockService {
  /**
   * Mark lesson completed, unlock next locked lesson in roadmap order,
   * recompute progressPercent.
   */
  async afterComplete(
    manager: EntityManager,
    userId: string,
    completedLesson: Lesson,
  ): Promise<{ unlockedLessonIds: string[]; progressPercent: number }> {
    completedLesson.status = LessonStatus.Completed;
    await manager.getRepository(Lesson).save(completedLesson);

    const roadmap = await this.loadRoadmapForLesson(manager, completedLesson);
    if (!roadmap) {
      return { unlockedLessonIds: [], progressPercent: 0 };
    }

    const ordered = this.flattenLessons(roadmap);
    const idx = ordered.findIndex((l) => l.id === completedLesson.id);
    const unlockedLessonIds: string[] = [];

    if (idx >= 0 && idx < ordered.length - 1) {
      const next = ordered[idx + 1];
      if (next.status === LessonStatus.Locked) {
        next.status = LessonStatus.Available;
        await manager.getRepository(Lesson).save(next);
        unlockedLessonIds.push(next.id);
      }
    }

    // Unlock next phase when crossing phase boundary
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
    // Also count lessons marked completed on the row (in case progress race)
    const total = ordered.length || 1;
    const completedFromRows = ordered.filter(
      (l) => l.status === LessonStatus.Completed || l.id === completedLesson.id,
    ).length;
    const done = Math.max(completedCount, completedFromRows);
    const progressPercent = Math.round((done / total) * 10000) / 100;

    roadmap.progressPercent = String(progressPercent);
    await manager.getRepository(Roadmap).save(roadmap);

    return { unlockedLessonIds, progressPercent };
  }

  private async loadRoadmapForLesson(
    manager: EntityManager,
    lesson: Lesson,
  ): Promise<Roadmap | null> {
    const withTree = await manager.getRepository(Lesson).findOne({
      where: { id: lesson.id },
      relations: {
        milestone: {
          phase: {
            roadmap: {
              phases: {
                milestones: {
                  lessons: true,
                },
              },
            },
          },
        },
      },
    });
    return withTree?.milestone?.phase?.roadmap ?? null;
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
          // attach for phase unlock
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
