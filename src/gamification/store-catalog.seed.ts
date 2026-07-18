import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  RewardCurrency,
} from './entities/reward-ledger-entry.entity';
import { StoreItem, StoreItemType } from './entities/store-item.entity';

type SeedRow = {
  sku: string;
  title: string;
  description: string;
  currency: RewardCurrency;
  price: number;
  itemType: StoreItemType;
  inventoryPayload: Record<string, unknown>;
  purchaseLimit?: number | null;
};

const CATALOG: SeedRow[] = [
  {
    sku: 'freeze-1d',
    title: '1-Day Streak Freeze',
    description: 'Protect one missed day',
    currency: RewardCurrency.Gems,
    price: 50,
    itemType: StoreItemType.Consumable,
    inventoryPayload: { kind: 'streak_freeze', days: 1 },
  },
  {
    sku: 'freeze-3d',
    title: '3-Day Freeze Pack',
    description: 'Three one-day freezes',
    currency: RewardCurrency.Gems,
    price: 120,
    itemType: StoreItemType.Consumable,
    inventoryPayload: { kind: 'streak_freeze', days: 1, quantity: 3 },
  },
  {
    sku: 'weekend-shield',
    title: 'Weekend Shield',
    description: 'Protect a weekend miss',
    currency: RewardCurrency.Gems,
    price: 85,
    itemType: StoreItemType.Consumable,
    inventoryPayload: { kind: 'streak_freeze', days: 1, weekend: true },
    purchaseLimit: 1,
  },
  {
    sku: 'restore-1d',
    title: 'Restore 1 Day',
    description: 'Recover a missed day within 48h',
    currency: RewardCurrency.Gems,
    price: 80,
    itemType: StoreItemType.Utility,
    inventoryPayload: { kind: 'streak_restore', days: 1 },
  },
  {
    sku: 'restore-2d',
    title: 'Restore 2 Days',
    description: 'Recover two missed days',
    currency: RewardCurrency.Gems,
    price: 150,
    itemType: StoreItemType.Utility,
    inventoryPayload: { kind: 'streak_restore', days: 2 },
  },
  {
    sku: 'restore-3d',
    title: 'Restore 3 Days',
    description: 'Once per month recovery',
    currency: RewardCurrency.Gems,
    price: 220,
    itemType: StoreItemType.Utility,
    inventoryPayload: { kind: 'streak_restore', days: 3 },
    purchaseLimit: 1,
  },
  {
    sku: 'hint-premium',
    title: 'Premium Hint',
    description: 'Hint without revealing answer',
    currency: RewardCurrency.Gems,
    price: 20,
    itemType: StoreItemType.Consumable,
    inventoryPayload: { kind: 'premium_hint' },
  },
  {
    sku: 'remove-two',
    title: 'Remove Two Wrong Options',
    description: 'Single-choice helper',
    currency: RewardCurrency.Gems,
    price: 15,
    itemType: StoreItemType.Consumable,
    inventoryPayload: { kind: 'remove_options' },
  },
  {
    sku: 'xp-boost-30',
    title: '30-Min XP Booster',
    description: '+20% XP · once/day',
    currency: RewardCurrency.Gems,
    price: 50,
    itemType: StoreItemType.Consumable,
    inventoryPayload: { kind: 'xp_booster', minutes: 30, mult: 1.2 },
    purchaseLimit: 1,
  },
  {
    sku: 'wheel-respin',
    title: 'Lucky Wheel Re-spin',
    description: 'Max 1/day',
    currency: RewardCurrency.Gems,
    price: 25,
    itemType: StoreItemType.Consumable,
    inventoryPayload: { kind: 'wheel_respin' },
    purchaseLimit: 1,
  },
  {
    sku: 'replan-token',
    title: 'Weekly Replan Token',
    description: 'Twice per week',
    currency: RewardCurrency.Gems,
    price: 30,
    itemType: StoreItemType.Consumable,
    inventoryPayload: { kind: 'replan_token' },
    purchaseLimit: 2,
  },
  {
    sku: 'chest-key-common',
    title: 'Common Chest Key',
    description: 'Weighted reward chest',
    currency: RewardCurrency.Gems,
    price: 75,
    itemType: StoreItemType.Key,
    inventoryPayload: { kind: 'chest_key', rarity: 'common' },
  },
  {
    sku: 'glasses-classic',
    title: 'Classic Round Glasses',
    description: 'Black frames',
    currency: RewardCurrency.Coins,
    price: 300,
    itemType: StoreItemType.Cosmetic,
    inventoryPayload: { kind: 'cosmetic', slot: 'glasses', variant: 'classic' },
  },
  {
    sku: 'hat-beanie',
    title: 'Arlo Beanie',
    description: 'Deep purple',
    currency: RewardCurrency.Coins,
    price: 500,
    itemType: StoreItemType.Cosmetic,
    inventoryPayload: { kind: 'cosmetic', slot: 'hat', variant: 'beanie' },
  },
  {
    sku: 'hoodie-lavender',
    title: 'Lavender Hoodie',
    description: 'Cosmetics',
    currency: RewardCurrency.Coins,
    price: 800,
    itemType: StoreItemType.Cosmetic,
    inventoryPayload: { kind: 'cosmetic', slot: 'clothing', variant: 'lavender' },
  },
  {
    sku: 'frame-bronze',
    title: 'Bronze Profile Frame',
    description: 'Cosmetic frame',
    currency: RewardCurrency.Coins,
    price: 600,
    itemType: StoreItemType.Cosmetic,
    inventoryPayload: { kind: 'cosmetic', slot: 'frame', variant: 'bronze' },
  },
  {
    sku: 'frame-gold',
    title: 'Gold Profile Frame',
    description: 'Cosmetic frame',
    currency: RewardCurrency.Coins,
    price: 1400,
    itemType: StoreItemType.Cosmetic,
    inventoryPayload: { kind: 'cosmetic', slot: 'frame', variant: 'gold' },
  },
  {
    sku: 'theme-battle',
    title: 'Battle Arena Theme',
    description: 'Purple + gold arena',
    currency: RewardCurrency.Coins,
    price: 2000,
    itemType: StoreItemType.Cosmetic,
    inventoryPayload: { kind: 'cosmetic', slot: 'theme', variant: 'battle' },
  },
];

@Injectable()
export class StoreCatalogSeedService implements OnModuleInit {
  private readonly logger = new Logger(StoreCatalogSeedService.name);

  constructor(
    @InjectRepository(StoreItem)
    private readonly itemsRepo: Repository<StoreItem>,
  ) {}

  async onModuleInit() {
    if (process.env.STORE_SEED === 'false') return;
    try {
      await this.ensureCatalog();
    } catch (err) {
      this.logger.warn(
        `Store seed skipped: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async ensureCatalog(): Promise<number> {
    let n = 0;
    for (const row of CATALOG) {
      const existing = await this.itemsRepo.findOne({ where: { sku: row.sku } });
      if (existing) continue;
      await this.itemsRepo.save(
        this.itemsRepo.create({
          sku: row.sku,
          title: row.title,
          description: row.description,
          currency: row.currency,
          price: row.price,
          itemType: row.itemType,
          inventoryPayload: row.inventoryPayload,
          purchaseLimit: row.purchaseLimit ?? null,
          isActive: true,
          version: 1,
        }),
      );
      n += 1;
    }
    if (n) this.logger.log(`Seeded ${n} store items`);
    return n;
  }
}
