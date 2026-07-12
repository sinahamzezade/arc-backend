import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GamificationModule } from '../gamification/gamification.module';
import { UserInventoryItem } from '../gamification/entities/user-inventory-item.entity';
import { LeaguesModule } from '../leagues/leagues.module';
import { UserBadge } from '../lessons/entities/user-badge.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { SocialModule } from '../social/social.module';
import { RankDefinition } from './entities/rank-definition.entity';
import { RankProgressRequirement } from './entities/rank-progress-requirement.entity';
import { RankUnlockHistory } from './entities/rank-unlock-history.entity';
import { UserRankState } from './entities/user-rank-state.entity';
import { RanksController } from './ranks.controller';
import { RanksService } from './ranks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RankDefinition,
      UserRankState,
      RankProgressRequirement,
      RankUnlockHistory,
      UserBadge,
      UserInventoryItem,
    ]),
    forwardRef(() => GamificationModule),
    ProfilesModule,
    NotificationsModule,
    SocialModule,
    forwardRef(() => LeaguesModule),
  ],
  controllers: [RanksController],
  providers: [RanksService],
  exports: [RanksService],
})
export class RanksModule {}
