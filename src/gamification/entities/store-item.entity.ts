import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RewardCurrency } from './reward-ledger-entry.entity';

export enum StoreItemType {
  Consumable = 'consumable',
  Cosmetic = 'cosmetic',
  Utility = 'utility',
  Key = 'key',
}

@Entity('store_items')
export class StoreItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  sku: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'enum', enum: RewardCurrency })
  currency: RewardCurrency;

  @Column({ type: 'int' })
  price: number;

  @Column({
    name: 'item_type',
    type: 'enum',
    enum: StoreItemType,
    default: StoreItemType.Consumable,
  })
  itemType: StoreItemType;

  @Column({ name: 'inventory_payload', type: 'jsonb', default: () => "'{}'" })
  inventoryPayload: Record<string, unknown>;

  @Column({ type: 'varchar', length: 32, default: 'common' })
  rarity: string;

  @Column({ name: 'availability_rules', type: 'jsonb', default: () => "'{}'" })
  availabilityRules: Record<string, unknown>;

  @Column({ name: 'purchase_limit', type: 'int', nullable: true })
  purchaseLimit: number | null;

  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt: Date | null;

  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
  endsAt: Date | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
