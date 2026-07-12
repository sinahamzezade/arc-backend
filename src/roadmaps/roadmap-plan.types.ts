import type { LessonTemplate } from '../skill-graph/entities/lesson-template.entity';
import type { LoadedSkillNode } from '../skill-graph/skill-graph.service';
import type { LessonStatus } from './entities/lesson.entity';

export type PlannedLesson = {
  template: LessonTemplate;
  title: string;
  missionName: string | null;
  resourceId: string | null;
  status: LessonStatus;
};

export type PlannedMilestone = {
  skill: LoadedSkillNode;
  title: string;
  type: string;
  compress: boolean;
  lessons: PlannedLesson[];
};

export type PlannedPhase = {
  key: string;
  title: string;
  techStackId: string | null;
  techStackSlug: string | null;
  orderIndex: number;
  locked: boolean;
  milestones: PlannedMilestone[];
};
