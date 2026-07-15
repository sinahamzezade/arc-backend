import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ContentPoolModule } from '../content-pool/content-pool.module';
import { Goal } from '../goals/entities/goal.entity';
import { Profile } from '../profiles/entities/profile.entity';
import { ReferralsModule } from '../referrals/referrals.module';
import { RoadmapsModule } from '../roadmaps/roadmaps.module';
import { SystemFlagsModule } from '../system-flags/system-flags.module';
import { LearnerProfileSnapshot } from './entities/learner-profile-snapshot.entity';
import { LearnerSkillEstimate } from './entities/learner-skill-estimate.entity';
import { QuestionnaireDefinition } from './entities/questionnaire-definition.entity';
import { QuestionnaireOption } from './entities/questionnaire-option.entity';
import { QuestionnaireResponse } from './entities/questionnaire-response.entity';
import { QuestionnaireStep } from './entities/questionnaire-step.entity';
import { IntakeChatService } from './intake-chat.service';
import { LearnerProfilingService } from './learner-profiling.service';
import { QuestionnaireController } from './questionnaire.controller';
import { QuestionnaireAiService } from './questionnaire-ai.service';
import { QuestionnaireSchemaService } from './questionnaire-schema.service';
import { QuestionnaireService } from './questionnaire.service';

/**
 * Question Engine — adaptive schema, learner profiling, goals, roadmap handoff.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      QuestionnaireResponse,
      QuestionnaireDefinition,
      QuestionnaireStep,
      QuestionnaireOption,
      LearnerProfileSnapshot,
      LearnerSkillEstimate,
      Goal,
      Profile,
    ]),
    AuthModule,
    ContentPoolModule,
    RoadmapsModule,
    SystemFlagsModule,
    forwardRef(() => ReferralsModule),
  ],
  controllers: [QuestionnaireController],
  providers: [
    QuestionnaireService,
    QuestionnaireSchemaService,
    QuestionnaireAiService,
    IntakeChatService,
    LearnerProfilingService,
  ],
  exports: [
    QuestionnaireService,
    QuestionnaireSchemaService,
    LearnerProfilingService,
  ],
})
export class QuestionnaireModule {}
