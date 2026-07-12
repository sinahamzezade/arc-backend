import { Injectable } from '@nestjs/common';

export type CoachReplanSignal = {
  roadmapId: string;
  reason: 'assessment' | 'progress' | 'pace' | 'stuck' | 'manual';
};

/**
 * AI Coach Engine scaffold.
 * Patches user roadmap instances; reads Skill Graph for remediation nodes.
 * Initial path still comes from Roadmap Generator (one-shot).
 */
@Injectable()
export class CoachService {
  /**
   * Placeholder until progress + assessment hooks land (doc 03 §5.1).
   */
  enqueueReplan(signal: CoachReplanSignal): { accepted: boolean } {
    void signal;
    return { accepted: false };
  }
}
