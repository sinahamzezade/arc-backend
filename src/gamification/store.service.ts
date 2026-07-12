import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import {
  RewardCurrency,
  RewardLedgerEntry,
  RewardReasonType,
} from './entities/reward-ledger-entry.entity';
import { StoreItem, StoreItemType } from './entities/store-item.entity';
import { UserInventoryItem } from './entities/user-inventory-item.entity';
import { RewardLedgerService } from './reward-ledger.service';

const FREEZE_SKUS = new Set(['freeze-1d', 'freeze-3d', 'weekend-shield']);
const MAX_FREEZE_STACK = 2;

@Injectable()
export class StoreService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: RewardLedgerService,
    @InjectRepository(StoreItem)
    private readonly itemsRepo: Repository<StoreItem>,
    @InjectRepository(UserInventoryItem)
    private readonly inventoryRepo: Repository<UserInventoryItem>,
  ) {}

  async listCatalog(filters?: {
    currency?: RewardCurrency;
    type?: StoreItemType;
  }) {
    const qb = this.itemsRepo
      .createQueryBuilder('i')
      .where('i.is_active = true')
      .orderBy('i.currency', 'ASC')
      .addOrderBy('i.price', 'ASC');

    if (filters?.currency) {
      qb.andWhere('i.currency = :currency', { currency: filters.currency });
    }
    if (filters?.type) {
      qb.andWhere('i.item_type = :type', { type: filters.type });
    }

    const now = new Date();
    const rows = await qb.getMany();
    return rows
      .filter((i) => {
        if (i.startsAt && i.startsAt > now) return false;
        if (i.endsAt && i.endsAt < now) return false;
        return true;
      })
      .map((i) => ({
        id: i.id,
        sku: i.sku,
        title: i.title,
        description: i.description,
        currency: i.currency,
        price: i.price,
        itemType: i.itemType,
        rarity: i.rarity,
        purchaseLimit: i.purchaseLimit,
        version: i.version,
      }));
  }

  async purchase(input: {
    userId: string;
    sku: string;
    idempotencyKey: string;
    quantity?: number;
  }) {
    const qty = Math.max(1, Math.min(99, input.quantity ?? 1));

    return this.dataSource.transaction(async (manager) => {
      const item = await manager.getRepository(StoreItem).findOne({
        where: { sku: input.sku, isActive: true },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item) {
        throw new AppException(
          AuthErrorCode.ITEM_NOT_AVAILABLE,
          'Store item not found or inactive',
          HttpStatus.NOT_FOUND,
        );
      }

      const now = new Date();
      if (item.startsAt && item.startsAt > now) {
        throw new AppException(
          AuthErrorCode.ITEM_NOT_AVAILABLE,
          'Item not yet available',
        );
      }
      if (item.endsAt && item.endsAt < now) {
        throw new AppException(
          AuthErrorCode.ITEM_NOT_AVAILABLE,
          'Item expired',
        );
      }

      if (
        item.currency !== RewardCurrency.Gems &&
        item.currency !== RewardCurrency.Coins
      ) {
        throw new AppException(
          AuthErrorCode.ITEM_NOT_AVAILABLE,
          'Item currency not purchasable',
        );
      }

      const invRepo = manager.getRepository(UserInventoryItem);
      const owned = await invRepo.find({
        where: { userId: input.userId, sku: item.sku },
      });
      const ownedQty = owned.reduce((s, r) => s + r.quantity, 0);

      if (item.itemType === StoreItemType.Cosmetic && ownedQty > 0) {
        throw new AppException(
          AuthErrorCode.ITEM_ALREADY_OWNED,
          'Cosmetic already owned',
        );
      }

      if (
        item.purchaseLimit != null &&
        ownedQty + qty > item.purchaseLimit
      ) {
        throw new AppException(
          AuthErrorCode.PURCHASE_LIMIT_REACHED,
          'Purchase limit reached',
        );
      }

      if (FREEZE_SKUS.has(item.sku)) {
        const freezeOwned = await this.countFreezeUnits(manager, input.userId);
        const addUnits =
          Number(item.inventoryPayload?.quantity ?? 1) * qty;
        if (freezeOwned + addUnits > MAX_FREEZE_STACK) {
          throw new AppException(
            AuthErrorCode.STREAK_FREEZE_LIMIT_REACHED,
            `Max ${MAX_FREEZE_STACK} freezes in inventory`,
          );
        }
      }

      const total = item.price * qty;
      const wallet = await this.ledger.ensureWallet(manager, input.userId, true);
      if (item.currency === RewardCurrency.Gems && wallet.gems < total) {
        throw new AppException(
          AuthErrorCode.INSUFFICIENT_GEMS,
          'Insufficient gems',
        );
      }
      if (item.currency === RewardCurrency.Coins && wallet.coins < total) {
        throw new AppException(
          AuthErrorCode.INSUFFICIENT_COINS,
          'Insufficient coins',
        );
      }

      const grant = await this.ledger.grantReward(manager, {
        userId: input.userId,
        reasonType: RewardReasonType.Store,
        reasonId: item.id,
        idempotencyKey: `store:${input.idempotencyKey}`,
        metadata: {
          sku: item.sku,
          price: item.price,
          quantity: qty,
          currency: item.currency,
          itemVersion: item.version,
        },
        lines: [
          {
            currency: item.currency,
            amount: -total,
            idempotencySuffix: 'spend',
          },
        ],
      });

      if (!grant.alreadyGranted) {
        await this.creditInventory(manager, {
          userId: input.userId,
          item,
          quantity: qty,
        });
      }

      const inventory = await invRepo.find({
        where: { userId: input.userId, sku: item.sku },
        order: { acquiredAt: 'DESC' },
      });

      return {
        alreadyPurchased: grant.alreadyGranted,
        transactionGroupId: grant.transactionGroupId,
        wallet: grant.wallet,
        item: {
          sku: item.sku,
          title: item.title,
          currency: item.currency,
          price: item.price,
          quantity: qty,
        },
        inventory: inventory.map((r) => ({
          id: r.id,
          sku: r.sku,
          quantity: r.quantity,
          equipped: r.equipped,
        })),
      };
    });
  }

  private async countFreezeUnits(
    manager: EntityManager,
    userId: string,
  ): Promise<number> {
    const rows = await manager.getRepository(UserInventoryItem).find({
      where: { userId },
    });
    return rows
      .filter((r) => FREEZE_SKUS.has(r.sku) || r.payload?.kind === 'streak_freeze')
      .reduce((s, r) => s + r.quantity, 0);
  }

  private async creditInventory(
    manager: EntityManager,
    input: { userId: string; item: StoreItem; quantity: number },
  ) {
    const invRepo = manager.getRepository(UserInventoryItem);
    const packQty = Number(input.item.inventoryPayload?.quantity ?? 1);
    const units = packQty * input.quantity;

    if (input.item.itemType === StoreItemType.Cosmetic) {
      await invRepo.save(
        invRepo.create({
          userId: input.userId,
          sku: input.item.sku,
          storeItemId: input.item.id,
          quantity: 1,
          equipped: false,
          acquiredFrom: 'store',
          payload: { ...input.item.inventoryPayload },
        }),
      );
      return;
    }

    const existing = await invRepo.findOne({
      where: { userId: input.userId, sku: input.item.sku },
      order: { acquiredAt: 'ASC' },
    });
    if (existing && input.item.itemType !== StoreItemType.Key) {
      existing.quantity += units;
      await invRepo.save(existing);
      return;
    }

    await invRepo.save(
      invRepo.create({
        userId: input.userId,
        sku: input.item.sku,
        storeItemId: input.item.id,
        quantity: units,
        equipped: false,
        acquiredFrom: 'store',
        payload: { ...input.item.inventoryPayload },
      }),
    );
  }
}
