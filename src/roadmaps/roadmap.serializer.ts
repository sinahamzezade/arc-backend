import { Injectable } from '@nestjs/common';
import { Roadmap } from './entities/roadmap.entity';
import { RoadmapGenerationJob } from './entities/roadmap-generation-job.entity';

export function toJobDto(job: RoadmapGenerationJob | null) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    roadmapId: job.roadmapId,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
  };
}

export function toRoadmapTreeDto(roadmap: Roadmap) {
  const phases = [...(roadmap.phases ?? [])].sort(
    (a, b) => a.orderIndex - b.orderIndex,
  );

  return {
    id: roadmap.id,
    title: roadmap.title,
    primaryRoleSlug: roadmap.primaryRoleSlug,
    timelineWeeks: roadmap.timelineWeeks,
    progressPercent: Number(roadmap.progressPercent),
    currentPhaseId: roadmap.currentPhaseId,
    status: roadmap.status,
    phases: phases.map((phase) => {
      const milestones = [...(phase.milestones ?? [])].sort(
        (a, b) => a.orderIndex - b.orderIndex,
      );
      return {
        id: phase.id,
        title: phase.title,
        orderIndex: phase.orderIndex,
        locked: phase.locked,
        techStackSlug: phase.techStackSlug,
        milestones: milestones.map((milestone) => {
          const lessons = [...(milestone.lessons ?? [])].sort(
            (a, b) => a.orderIndex - b.orderIndex,
          );
          return {
            id: milestone.id,
            title: milestone.title,
            orderIndex: milestone.orderIndex,
            type: milestone.type,
            lessons: lessons.map((lesson) => ({
              id: lesson.id,
              title: lesson.title,
              missionName: lesson.missionName,
              lessonType: lesson.lessonType,
              estimatedMinutes: lesson.estimatedMinutes,
              xpReward: lesson.xpReward,
              orderIndex: lesson.orderIndex,
              status: lesson.status,
              resource: lesson.resource
                ? {
                    id: lesson.resource.id,
                    title: lesson.resource.title,
                    url: lesson.resource.url,
                    provider: lesson.resource.provider,
                  }
                : null,
            })),
          };
        }),
      };
    }),
  };
}

@Injectable()
export class RoadmapSerializer {
  toJob = toJobDto;
  toTree = toRoadmapTreeDto;
}
