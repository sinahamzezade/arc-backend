import { Lesson, LessonStatus } from './entities/lesson.entity';
import { Milestone } from './entities/milestone.entity';
import { Roadmap } from './entities/roadmap.entity';
import { RoadmapPhase } from './entities/roadmap-phase.entity';
import type { RoadmapTreeCachePayload } from './roadmap-cache.service';

export function roadmapFromTreeDto(dto: RoadmapTreeCachePayload): Roadmap {
  const roadmap = Object.assign(new Roadmap(), {
    id: dto.id,
    title: dto.title,
    primaryRoleSlug: dto.primaryRoleSlug,
    timelineWeeks: dto.timelineWeeks,
    progressPercent: String(dto.progressPercent),
    currentPhaseId: dto.currentPhaseId,
    status: dto.status,
  });

  roadmap.phases = dto.phases.map((phaseDto) => {
    const phase = Object.assign(new RoadmapPhase(), {
      id: phaseDto.id,
      title: phaseDto.title,
      orderIndex: phaseDto.orderIndex,
      locked: phaseDto.locked,
      techStackSlug: phaseDto.techStackSlug,
      roadmapId: dto.id,
    });

    phase.milestones = phaseDto.milestones.map((milestoneDto) => {
      const milestone = Object.assign(new Milestone(), {
        id: milestoneDto.id,
        title: milestoneDto.title,
        orderIndex: milestoneDto.orderIndex,
        type: milestoneDto.type,
        phaseId: phaseDto.id,
      });

      milestone.lessons = milestoneDto.lessons.map((lessonDto) => {
        const lesson = Object.assign(new Lesson(), {
          id: lessonDto.id,
          title: lessonDto.title,
          missionName: lessonDto.missionName,
          lessonType: lessonDto.lessonType,
          estimatedMinutes: lessonDto.estimatedMinutes,
          xpReward: lessonDto.xpReward,
          orderIndex: lessonDto.orderIndex,
          status: lessonDto.status as LessonStatus,
          required: lessonDto.required !== false,
          unitId: lessonDto.unitId ?? null,
          milestoneId: milestoneDto.id,
          resource: lessonDto.resource,
        });
        (lesson as Lesson & { milestone?: Milestone }).milestone = milestone;
        return lesson;
      });

      (milestone as Milestone & { phase?: RoadmapPhase }).phase = phase;
      return milestone;
    });

    return phase;
  });

  return roadmap;
}

export function buildLessonOrdinals(roadmap: Roadmap): Record<string, number> {
  const out: Record<string, number> = {};
  let ordinal = 0;
  const phases = [...(roadmap.phases ?? [])].sort(
    (a, b) => a.orderIndex - b.orderIndex,
  );
  for (const phase of phases) {
    const milestones = [...(phase.milestones ?? [])].sort(
      (a, b) => a.orderIndex - b.orderIndex,
    );
    for (const milestone of milestones) {
      const lessons = [...(milestone.lessons ?? [])].sort(
        (a, b) => a.orderIndex - b.orderIndex,
      );
      for (const lesson of lessons) {
        ordinal += 1;
        out[lesson.id] = ordinal;
      }
    }
  }
  return out;
}
