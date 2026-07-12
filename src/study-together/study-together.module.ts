import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BadgesModule } from '../badges/badges.module';
import { GamificationModule } from '../gamification/gamification.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Profile } from '../profiles/entities/profile.entity';
import { SocialModule } from '../social/social.module';
import { User } from '../users/entities/user.entity';
import { StudySessionEvent } from './entities/study-session-event.entity';
import { StudySessionParticipant } from './entities/study-session-participant.entity';
import { StudySession } from './entities/study-session.entity';
import { StudyTogetherController } from './study-together.controller';
import { StudyTogetherService } from './study-together.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StudySession,
      StudySessionParticipant,
      StudySessionEvent,
      Profile,
      User,
    ]),
    SocialModule,
    NotificationsModule,
    forwardRef(() => GamificationModule),
    forwardRef(() => BadgesModule),
  ],
  controllers: [StudyTogetherController],
  providers: [StudyTogetherService],
  exports: [StudyTogetherService],
})
export class StudyTogetherModule {}
