import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GamificationModule } from '../gamification/gamification.module';
import { UserBadge } from '../badges/entities/user-badge.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { WheelCampaign } from './entities/wheel-campaign.entity';
import { WheelRewardInventory } from './entities/wheel-reward-inventory.entity';
import { WheelSegmentRule } from './entities/wheel-segment-rule.entity';
import { WheelSpin } from './entities/wheel-spin.entity';
import { WheelUserDay } from './entities/wheel-user-day.entity';
import { LuckyWheelController } from './lucky-wheel.controller';
import { LuckyWheelService } from './lucky-wheel.service';
import { WheelLayoutService } from './wheel-layout.service';
import { WheelRngService } from './wheel-rng.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WheelCampaign,
      WheelSegmentRule,
      WheelUserDay,
      WheelSpin,
      WheelRewardInventory,
      UserBadge,
    ]),
    GamificationModule,
    ProfilesModule,
    NotificationsModule,
  ],
  controllers: [LuckyWheelController],
  providers: [LuckyWheelService, WheelLayoutService, WheelRngService],
  exports: [LuckyWheelService],
})
export class LuckyWheelModule {}
