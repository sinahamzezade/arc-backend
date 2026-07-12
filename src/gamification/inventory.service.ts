import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { StoreItemType } from './entities/store-item.entity';
import { UserInventoryItem } from './entities/user-inventory-item.entity';
import { StoreItem } from './entities/store-item.entity';

@Injectable()
export class InventoryService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(UserInventoryItem)
    private readonly inventoryRepo: Repository<UserInventoryItem>,
  ) {}

  async list(userId: string) {
    const rows = await this.inventoryRepo.find({
      where: { userId },
      order: { acquiredAt: 'DESC' },
    });
    return rows.map((r) => ({
      id: r.id,
      sku: r.sku,
      quantity: r.quantity,
      equipped: r.equipped,
      acquiredFrom: r.acquiredFrom,
      payload: r.payload,
      expiresAt: r.expiresAt,
      acquiredAt: r.acquiredAt,
    }));
  }

  async equip(userId: string, inventoryId: string) {
    return this.dataSource.transaction(async (manager) => {
      const invRepo = manager.getRepository(UserInventoryItem);
      const item = await invRepo.findOne({
        where: { id: inventoryId, userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item) {
        throw new AppException(
          AuthErrorCode.INVENTORY_ITEM_NOT_FOUND,
          'Inventory item not found',
          HttpStatus.NOT_FOUND,
        );
      }

      const store = item.storeItemId
        ? await manager.getRepository(StoreItem).findOne({
            where: { id: item.storeItemId },
          })
        : await manager.getRepository(StoreItem).findOne({
            where: { sku: item.sku },
          });

      if (store && store.itemType !== StoreItemType.Cosmetic) {
        throw new AppException(
          AuthErrorCode.ITEM_NOT_AVAILABLE,
          'Only cosmetics can be equipped',
        );
      }

      const slot =
        (item.payload?.slot as string | undefined) ??
        (store?.inventoryPayload?.slot as string | undefined) ??
        'default';

      const owned = await invRepo.find({ where: { userId } });
      for (const row of owned) {
        const rowSlot =
          (row.payload?.slot as string | undefined) ?? 'default';
        if (row.equipped && rowSlot === slot && row.id !== item.id) {
          row.equipped = false;
          await invRepo.save(row);
        }
      }

      item.equipped = true;
      await invRepo.save(item);

      return {
        id: item.id,
        sku: item.sku,
        equipped: true,
        slot,
      };
    });
  }
}
