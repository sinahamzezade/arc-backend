import { Lesson, LessonStatus } from './entities/lesson.entity';
import { Roadmap } from './entities/roadmap.entity';

export type MapNodeState = 'locked' | 'unlocked' | 'completed';

export function mapLessonState(status: LessonStatus): MapNodeState {
  if (status === LessonStatus.Completed) return 'completed';
  if (status === LessonStatus.Available) return 'unlocked';
  return 'locked';
}

export function mapLessonIcon(lessonType: string): string {
  const t = lessonType.toLowerCase();
  if (t.includes('scenario')) return 'compass';
  if (t.includes('sandbox')) return 'flask';
  if (t.includes('hotspot') || t.includes('visual')) return 'eye';
  if (t.includes('debate')) return 'chat';
  if (t.includes('quiz') || t.includes('checkpoint')) return 'shield';
  if (t.includes('project') || t.includes('challenge')) return 'star';
  if (t.includes('video')) return 'play';
  if (t.includes('practice')) return 'dumbbell';
  return 'book';
}

export function projectRoadmapMap(roadmap: Roadmap) {
  const phases = [...(roadmap.phases ?? [])].sort(
    (a, b) => a.orderIndex - b.orderIndex,
  );

  return {
    roadmapId: roadmap.id,
    goalToken: roadmap.primaryRoleSlug,
    phases: phases.map((phase, lane) => {
      const careerLessons: Array<{ lesson: Lesson; x: number }> = [];
      let x = 0;
      for (const milestone of [...(phase.milestones ?? [])].sort(
        (a, b) => a.orderIndex - b.orderIndex,
      )) {
        for (const lesson of [...(milestone.lessons ?? [])].sort(
          (a, b) => a.orderIndex - b.orderIndex,
        )) {
          if (lesson.entryAction === 'study_together') continue;
          careerLessons.push({ lesson, x: x++ });
        }
      }

      return {
        phaseId: phase.id,
        title: phase.title,
        narrativeTitle: phase.narrativeTitle ?? phase.title,
        lane,
        nodes: careerLessons.map(({ lesson, x: nodeX }) => ({
          unitId: lesson.unitId ?? null,
          lessonId: lesson.id,
          x: nodeX,
          y: lane,
          type: lesson.lessonType,
          state: mapLessonState(lesson.status),
          icon: mapLessonIcon(lesson.lessonType),
        })),
      };
    }),
    branchPoints: [] as Array<{
      afterUnitId: string;
      branches: string[];
    }>,
  };
}
