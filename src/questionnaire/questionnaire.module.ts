import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Goal } from '../goals/entities/goal.entity';
import { Profile } from '../profiles/entities/profile.entity';
import { ReferralsModule } from '../referrals/referrals.module';
import { RoadmapsModule } from '../roadmaps/roadmaps.module';
import { RoleRecipe } from '../skill-graph/entities/role-recipe.entity';
import { QuestionnaireDefinition } from './entities/questionnaire-definition.entity';
import { QuestionnaireOption } from './entities/questionnaire-option.entity';
import { QuestionnaireResponse } from './entities/questionnaire-response.entity';
import { QuestionnaireStep } from './entities/questionnaire-step.entity';
import { IntakeChatService } from './intake-chat.service';
import { QuestionnaireController } from './questionnaire.controller';
import { QuestionnaireAiService } from './questionnaire-ai.service';
import { QuestionnaireSchemaService } from './questionnaire-schema.service';
import { QuestionnaireService } from './questionnaire.service';

/**
 * Question Engine — adaptive schema, branching, answers → goals.
 * RoleRecipe read-only for goal suggestion chips.
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
      RoleRecipe,
    ]),
    AuthModule,
    RoadmapsModule,
    forwardRef(() => ReferralsModule),
  ],
  controllers: [QuestionnaireController],
  providers: [
    QuestionnaireService,
    QuestionnaireSchemaService,
    QuestionnaireAiService,
    IntakeChatService,
  ],
  exports: [QuestionnaireService, QuestionnaireSchemaService],
})
export class QuestionnaireModule {}
