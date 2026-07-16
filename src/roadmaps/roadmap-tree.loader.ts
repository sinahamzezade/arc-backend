import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Lesson } from './entities/lesson.entity';
import { Milestone } from './entities/milestone.entity';
import { Roadmap, RoadmapStatus } from './entities/roadmap.entity';
import { RoadmapPhase } from './entities/roadmap-phase.entity';
import { RoadmapCacheService } from './roadmap-cache.service';
import { buildLessonOrdinals, roadmapFromTreeDto } from './roadmap-tree.cache';

/** Metadata-only roadmap tree loader — excludes heavy JSONB `play_content`. */
@Injectable()
export class RoadmapTreeLoader {
  constructor(
    @InjectRepository(Roadmap)
    private readonly roadmapsRepo: Repository<Roadmap>,
    @InjectRepository(RoadmapPhase)
    private readonly phasesRepo: Repository<RoadmapPhase>,
    @InjectRepository(Milestone)
    private readonly milestonesRepo: Repository<Milestone>,
    @InjectRepository(Lesson)
    private readonly lessonsRepo: Repository<Lesson>,
    private readonly roadmapCache: RoadmapCacheService,
  ) {}

  async loadActiveRoadmap(userId: string): Promise<Roadmap | null> {
    const cachedId = await this.roadmapCache.getActiveRoadmapId(userId);
    if (cachedId) {
      const cachedTree = await this.roadmapCache.getTree(cachedId);
      if (cachedTree) {
        return roadmapFromTreeDto(cachedTree);
      }
    }

    const roadmap = await this.roadmapsRepo.findOne({
      where: {
        userId,
        status: In([
          RoadmapStatus.Ready,
          RoadmapStatus.Generating,
          RoadmapStatus.Completed,
        ]),
      },
      order: { updatedAt: 'DESC' },
    });
    // Prefer an active (ready/generating) roadmap over a finished one.
    if (roadmap?.status === RoadmapStatus.Completed) {
      const active = await this.roadmapsRepo.findOne({
        where: {
          userId,
          status: In([RoadmapStatus.Ready, RoadmapStatus.Generating]),
        },
        order: { updatedAt: 'DESC' },
      });
      if (active) {
        return this.hydrateAndCache(active, userId);
      }
    }
    if (!roadmap) return null;
    return this.hydrateAndCache(roadmap, userId);
  }

  async loadRoadmapTree(roadmapId: string): Promise<Roadmap | null> {
    const cachedTree = await this.roadmapCache.getTree(roadmapId);
    if (cachedTree) {
      return roadmapFromTreeDto(cachedTree);
    }

    const roadmap = await this.roadmapsRepo.findOne({
      where: { id: roadmapId },
    });
    if (!roadmap) return null;
    return this.hydrateAndCache(roadmap);
  }

  async loadRoadmapTreeForLesson(lessonId: string): Promise<Roadmap | null> {
    const lesson = await this.lessonsRepo.findOne({
      where: { id: lessonId },
      relations: {
        milestone: {
          phase: true,
        },
      },
    });
    const roadmapId = lesson?.milestone?.phase?.roadmapId;
    if (!roadmapId) return null;
    return this.loadRoadmapTree(roadmapId);
  }

  async getLessonOrdinals(roadmapId: string): Promise<Record<string, number>> {
    const cached = await this.roadmapCache.getOrdinals(roadmapId);
    if (cached) return cached;

    const roadmap = await this.loadRoadmapTree(roadmapId);
    if (!roadmap) return {};
    const ordinals = buildLessonOrdinals(roadmap);
    await this.roadmapCache.setOrdinals(roadmapId, ordinals);
    return ordinals;
  }

  private async hydrateAndCache(
    roadmap: Roadmap,
    userId?: string,
  ): Promise<Roadmap> {
    const hydrated = await this.hydrateTree(roadmap);
    await this.roadmapCache.setTree(hydrated);
    await this.roadmapCache.setOrdinals(
      hydrated.id,
      buildLessonOrdinals(hydrated),
    );
    if (userId) {
      await this.roadmapCache.setActiveRoadmapId(userId, hydrated.id);
    }
    return hydrated;
  }

  private async hydrateTree(roadmap: Roadmap): Promise<Roadmap> {
    const phases = await this.phasesRepo.find({
      where: { roadmapId: roadmap.id },
      order: { orderIndex: 'ASC' },
    });
    const phaseIds = phases.map((p) => p.id);
    const milestones = phaseIds.length
      ? await this.milestonesRepo.find({
          where: { phaseId: In(phaseIds) },
          order: { orderIndex: 'ASC' },
        })
      : [];
    const milestoneIds = milestones.map((m) => m.id);
    const lessons = milestoneIds.length
      ? await this.lessonsRepo
          .createQueryBuilder('lesson')
          .leftJoinAndSelect('lesson.resource', 'resource')
          .where('lesson.milestone_id IN (:...milestoneIds)', { milestoneIds })
          .orderBy('lesson.order_index', 'ASC')
          .select([
            'lesson.id',
            'lesson.milestoneId',
            'lesson.unitId',
            'lesson.title',
            'lesson.missionName',
            'lesson.lessonType',
            'lesson.estimatedMinutes',
            'lesson.xpReward',
            'lesson.orderIndex',
            'lesson.status',
            'lesson.required',
            'lesson.skillsTaught',
            'lesson.resourceId',
            'resource.id',
            'resource.title',
            'resource.url',
            'resource.provider',
          ])
          .getMany()
      : [];

    const lessonsByMilestone = new Map<string, Lesson[]>();
    for (const lesson of lessons) {
      const bucket = lessonsByMilestone.get(lesson.milestoneId) ?? [];
      bucket.push(lesson);
      lessonsByMilestone.set(lesson.milestoneId, bucket);
    }

    const milestonesByPhase = new Map<string, Milestone[]>();
    for (const milestone of milestones) {
      milestone.lessons = lessonsByMilestone.get(milestone.id) ?? [];
      const bucket = milestonesByPhase.get(milestone.phaseId) ?? [];
      bucket.push(milestone);
      milestonesByPhase.set(milestone.phaseId, bucket);
    }

    roadmap.phases = phases.map((phase) => {
      phase.milestones = milestonesByPhase.get(phase.id) ?? [];
      return phase;
    });

    return roadmap;
  }
}
