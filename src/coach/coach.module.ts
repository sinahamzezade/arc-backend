import { Module, forwardRef } from '@nestjs/common';
import { RoadmapsModule } from '../roadmaps/roadmaps.module';
import { CoachService } from './coach.service';

/**
 * AI Coach Engine — continuous roadmap instance updates from progress / assessments.
 * Does not mutate Skill Graph catalog rows.
 */
@Module({
  imports: [forwardRef(() => RoadmapsModule)],
  providers: [CoachService],
  exports: [CoachService],
})
export class CoachModule {}
