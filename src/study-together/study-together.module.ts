import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BadgesModule } from '../badges/badges.module';
import { GamificationModule } from '../gamification/gamification.module';
import { LessonsModule } from '../lessons/lessons.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { Profile } from '../profiles/entities/profile.entity';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import { Roadmap } from '../roadmaps/entities/roadmap.entity';
import { SocialModule } from '../social/social.module';
import { UploadsModule } from '../uploads/uploads.module';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { StudySessionEvent } from './entities/study-session-event.entity';
import { StudySessionMessage } from './entities/study-session-message.entity';
import { StudySessionParticipant } from './entities/study-session-participant.entity';
import { StudySession } from './entities/study-session.entity';
import { StudyTogetherController } from './study-together.controller';
import { StudyTogetherGateway } from './study-together.gateway';
import { StudyTogetherSchemaService } from './study-together-schema.service';
import { StudyTogetherService } from './study-together.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StudySession,
      StudySessionParticipant,
      StudySessionEvent,
      StudySessionMessage,
      Profile,
      User,
      Lesson,
      Roadmap,
    ]),
    SocialModule,
    NotificationsModule,
    ProfilesModule,
    AuthModule,
    UsersModule,
    LessonsModule,
    UploadsModule,
    forwardRef(() => GamificationModule),
    forwardRef(() => BadgesModule),
  ],
  controllers: [StudyTogetherController],
  providers: [
    StudyTogetherService,
    StudyTogetherGateway,
    StudyTogetherSchemaService,
  ],
  exports: [StudyTogetherService, StudyTogetherGateway],
})
export class StudyTogetherModule {}
