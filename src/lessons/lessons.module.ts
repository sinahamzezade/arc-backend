import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import { LessonProgress } from '../roadmaps/entities/lesson-progress.entity';
import { Roadmap } from '../roadmaps/entities/roadmap.entity';
import { WeeksModule } from '../weeks/weeks.module';
import { UserBadge } from './entities/user-badge.entity';
import { LessonContentService } from './lesson-content.service';
import { LessonRewardsService } from './lesson-rewards.service';
import { LessonUnlockService } from './lesson-unlock.service';
import { LessonsController } from './lessons.controller';
import { LessonsService } from './lessons.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Lesson,
      LessonProgress,
      Roadmap,
      UserBadge,
    ]),
    AuthModule,
    ProfilesModule,
    forwardRef(() => WeeksModule),
  ],
  controllers: [LessonsController],
  providers: [
    LessonsService,
    LessonContentService,
    LessonRewardsService,
    LessonUnlockService,
  ],
  exports: [LessonsService],
})
export class LessonsModule {}
