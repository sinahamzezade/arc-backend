import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class RoadmapAnalyticsService {
  private readonly logger = new Logger(RoadmapAnalyticsService.name);

  emit(event: string, payload: Record<string, unknown>) {
    this.logger.log(
      JSON.stringify({
        event,
        ts: new Date().toISOString(),
        ...payload,
      }),
    );
  }

  roadmapGenerated(payload: {
    roadmapId: string;
    goalRevision: string;
    engineVersion: number;
    estimatedWeeks: number;
    phaseCount: number;
  }) {
    this.emit('roadmap_generated', payload);
  }

  roadmapReplanned(payload: {
    roadmapId: string;
    trigger: string;
    weeksShifted: number;
    lessonsInserted: number;
  }) {
    this.emit('roadmap_replanned', payload);
  }

  roadmapGenerationFailed(payload: {
    goalRevision: string;
    code: string;
    stage: string;
  }) {
    this.emit('roadmap_generation_failed', payload);
  }

  roadmapFeasibilityReturned(payload: {
    goalRevision: string;
    earliestRealisticDate: string | null;
  }) {
    this.emit('roadmap_feasibility_returned', payload);
  }
}
