import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BadgesModule } from '../badges/badges.module';
import { LeaguesModule } from '../leagues/leagues.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Profile } from '../profiles/entities/profile.entity';
import { RanksModule } from '../ranks/ranks.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { OutboxEvent } from './entities/outbox-event.entity';
import { RewardLedgerEntry } from './entities/reward-ledger-entry.entity';
import { StoreItem } from './entities/store-item.entity';
import { StreakDay } from './entities/streak-day.entity';
import { StreakState } from './entities/streak-state.entity';
import { UserInventoryItem } from './entities/user-inventory-item.entity';
import { Wallet } from './entities/wallet.entity';
import { GamificationService } from './gamification.service';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { OutboxService } from './outbox.service';
import { RewardCalculatorService } from './reward-calculator.service';
import { RewardLedgerService } from './reward-ledger.service';
import { StoreCatalogSeedService } from './store-catalog.seed';
import { StoreController } from './store.controller';
import { StoreService } from './store.service';
import { StreakController } from './streak.controller';
import { StreakService } from './streak.service';
import { RewardsController, WalletController } from './wallet.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Wallet,
      RewardLedgerEntry,
      OutboxEvent,
      Profile,
      StoreItem,
      UserInventoryItem,
      StreakState,
      StreakDay,
    ]),
    forwardRef(() => LeaguesModule),
    forwardRef(() => NotificationsModule),
    forwardRef(() => RanksModule),
    forwardRef(() => ReferralsModule),
    forwardRef(() => BadgesModule),
  ],
  controllers: [
    WalletController,
    RewardsController,
    StoreController,
    InventoryController,
    StreakController,
  ],
  providers: [
    RewardLedgerService,
    OutboxService,
    GamificationService,
    RewardCalculatorService,
    StoreService,
    InventoryService,
    StreakService,
    StoreCatalogSeedService,
  ],
  exports: [
    GamificationService,
    RewardLedgerService,
    OutboxService,
    RewardCalculatorService,
    StreakService,
    StoreService,
  ],
})
export class GamificationModule {}
