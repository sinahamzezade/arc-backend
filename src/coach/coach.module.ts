import { Module } from '@nestjs/common';
import { CoachService } from './coach.service';

/**
 * AI Coach Engine — continuous roadmap instance updates from progress / assessments.
 * Does not mutate Skill Graph catalog rows.
 */
@Module({
  providers: [CoachService],
  exports: [CoachService],
})
export class CoachModule {}
