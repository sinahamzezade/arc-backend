import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GamificationModule } from '../gamification/gamification.module';
import { UserInventoryItem } from '../gamification/entities/user-inventory-item.entity';
import { UserBadge } from '../lessons/entities/user-badge.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { Profile } from '../profiles/entities/profile.entity';
import { ProfilesModule } from '../profiles/profiles.module';
import { LessonProgress } from '../roadmaps/entities/lesson-progress.entity';
import { Roadmap } from '../roadmaps/entities/roadmap.entity';
import { User } from '../users/entities/user.entity';
import { ReferralAttribution } from './entities/referral-attribution.entity';
import { ReferralClick } from './entities/referral-click.entity';
import { ReferralCode } from './entities/referral-code.entity';
import { ReferralLink } from './entities/referral-link.entity';
import { ReferralMilestone } from './entities/referral-milestone.entity';
import { ReferralRewardGrant } from './entities/referral-reward-grant.entity';
import { ReferralRiskReview } from './entities/referral-risk-review.entity';
import { ReferralShareEvent } from './entities/referral-share-event.entity';
import { PublicReferralController } from './public-referral.controller';
import { ReferralClickController } from './referral-click.controller';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReferralCode,
      ReferralLink,
      ReferralClick,
      ReferralAttribution,
      ReferralRewardGrant,
      ReferralMilestone,
      ReferralShareEvent,
      ReferralRiskReview,
      Profile,
      User,
      LessonProgress,
      Roadmap,
      UserBadge,
      UserInventoryItem,
    ]),
    ProfilesModule,
    NotificationsModule,
    forwardRef(() => GamificationModule),
  ],
  controllers: [
    ReferralsController,
    PublicReferralController,
    ReferralClickController,
  ],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
