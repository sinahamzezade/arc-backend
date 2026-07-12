import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserLeagueState } from '../leagues/entities/user-league-state.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { Profile } from '../profiles/entities/profile.entity';
import { User } from '../users/entities/user.entity';
import { Follow } from './entities/follow.entity';
import { FriendRequest } from './entities/friend-request.entity';
import { Friendship } from './entities/friendship.entity';
import { SocialActivityEvent } from './entities/social-activity-event.entity';
import { SocialCounter } from './entities/social-counter.entity';
import { SocialPrivacySettings } from './entities/social-privacy-settings.entity';
import { UserBlock } from './entities/user-block.entity';
import { UserReport } from './entities/user-report.entity';
import { SocialPermissionService } from './social-permission.service';
import { SocialPresenceService } from './social-presence.service';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Friendship,
      FriendRequest,
      UserBlock,
      Follow,
      SocialPrivacySettings,
      SocialActivityEvent,
      SocialCounter,
      UserReport,
      Profile,
      User,
      UserLeagueState,
    ]),
    NotificationsModule,
  ],
  controllers: [SocialController],
  providers: [SocialService, SocialPermissionService, SocialPresenceService],
  exports: [SocialService, SocialPermissionService, SocialPresenceService],
})
export class SocialModule {}
