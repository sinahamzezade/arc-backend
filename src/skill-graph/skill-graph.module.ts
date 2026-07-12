import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssessmentTemplate } from './entities/assessment-template.entity';
import { LessonTemplate } from './entities/lesson-template.entity';
import { Resource } from './entities/resource.entity';
import { RoleRecipe } from './entities/role-recipe.entity';
import { SkillNode } from './entities/skill-node.entity';
import { TechStack } from './entities/tech-stack.entity';
import { SkillGraphService } from './skill-graph.service';

/**
 * Skill Graph Engine — shared curriculum DAG.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      TechStack,
      SkillNode,
      LessonTemplate,
      AssessmentTemplate,
      Resource,
      RoleRecipe,
    ]),
  ],
  providers: [SkillGraphService],
  exports: [SkillGraphService, TypeOrmModule],
})
export class SkillGraphModule {}
