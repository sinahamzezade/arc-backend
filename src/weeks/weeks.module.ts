import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { GoalsModule } from '../goals/goals.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { RoadmapsModule } from '../roadmaps/roadmaps.module';
import { WeeklyPlan } from './entities/weekly-plan.entity';
import { WeeklyTask } from './entities/weekly-task.entity';
import { WeeksController } from './weeks.controller';
import { WeeksPlannerService } from './weeks.planner.service';
import { WeeksService } from './weeks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([WeeklyPlan, WeeklyTask]),
    AuthModule,
    ProfilesModule,
    GoalsModule,
    RoadmapsModule,
    NotificationsModule,
  ],
  controllers: [WeeksController],
  providers: [WeeksService, WeeksPlannerService],
  exports: [WeeksService],
})
export class WeeksModule {}
