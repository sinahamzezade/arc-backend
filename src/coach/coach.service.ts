import { Injectable } from '@nestjs/common';
import { RoadmapsService } from '../roadmaps/roadmaps.service';

export type CoachReplanSignal = {
  roadmapId: string;
  reason: 'assessment' | 'progress' | 'pace' | 'stuck' | 'manual';
};

/**
 * AI Coach Engine — continuous roadmap instance updates from progress / assessments.
 * Enqueues replan via RoadmapsService (BullMQ when Redis available).
 */
@Injectable()
export class CoachService {
  constructor(private readonly roadmaps: RoadmapsService) {}

  enqueueReplan(signal: CoachReplanSignal): { accepted: boolean; roadmapId?: string } {
    try {
      // Fire-and-forget; caller gets accepted immediately
      void this.roadmaps.replanRoadmap(signal.roadmapId, signal.reason).catch(() => {
        // errors logged inside roadmaps service / processor
      });
      return { accepted: true, roadmapId: signal.roadmapId };
    } catch {
      return { accepted: false };
    }
  }
}
