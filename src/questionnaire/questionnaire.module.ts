import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Goal } from '../goals/entities/goal.entity';
import { Profile } from '../profiles/entities/profile.entity';
import { RoadmapsModule } from '../roadmaps/roadmaps.module';
import { QuestionnaireDefinition } from './entities/questionnaire-definition.entity';
import { QuestionnaireOption } from './entities/questionnaire-option.entity';
import { QuestionnaireResponse } from './entities/questionnaire-response.entity';
import { QuestionnaireStep } from './entities/questionnaire-step.entity';
import { QuestionnaireController } from './questionnaire.controller';
import { QuestionnaireAiService } from './questionnaire-ai.service';
import { QuestionnaireSchemaService } from './questionnaire-schema.service';
import { QuestionnaireService } from './questionnaire.service';

/**
 * Question Engine — adaptive schema, branching, answers → goals.
 * Must not import skill-graph or coach. Handoff = RoadmapsService.enqueueGenerate only.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      QuestionnaireResponse,
      QuestionnaireDefinition,
      QuestionnaireStep,
      QuestionnaireOption,
      Goal,
      Profile,
    ]),
    AuthModule,
    RoadmapsModule,
  ],
  controllers: [QuestionnaireController],
  providers: [
    QuestionnaireService,
    QuestionnaireSchemaService,
    QuestionnaireAiService,
  ],
  exports: [QuestionnaireService, QuestionnaireSchemaService],
})
export class QuestionnaireModule {}
