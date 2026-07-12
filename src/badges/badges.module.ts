import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GamificationModule } from '../gamification/gamification.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LessonProgress } from '../roadmaps/entities/lesson-progress.entity';
import { BadgesCatalogSeedService } from './badges-catalog.seed.service';
import { BadgesController } from './badges.controller';
import { BadgesService } from './badges.service';
import { BadgeDefinition } from './entities/badge-definition.entity';
import { BadgeFeaturedSlot } from './entities/badge-featured-slot.entity';
import { BadgeUnlockEvent } from './entities/badge-unlock-event.entity';
import { BadgeUserSettings } from './entities/badge-user-settings.entity';
import { UserBadge } from './entities/user-badge.entity';
import { UserBadgeProgress } from './entities/user-badge-progress.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BadgeDefinition,
      UserBadge,
      UserBadgeProgress,
      BadgeUnlockEvent,
      BadgeFeaturedSlot,
      BadgeUserSettings,
      LessonProgress,
    ]),
    forwardRef(() => GamificationModule),
    NotificationsModule,
  ],
  controllers: [BadgesController],
  providers: [BadgesService, BadgesCatalogSeedService],
  exports: [BadgesService, TypeOrmModule],
})
export class BadgesModule {}
