import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { StoreItem } from './store-item.entity';

@Entity('user_inventory_items')
@Index(['userId', 'sku'])
export class UserInventoryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 64 })
  sku: string;

  @Column({ name: 'store_item_id', type: 'uuid', nullable: true })
  storeItemId: string | null;

  @ManyToOne(() => StoreItem, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'store_item_id' })
  storeItem: StoreItem | null;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({ type: 'boolean', default: false })
  equipped: boolean;

  @Column({ name: 'acquired_from', type: 'varchar', length: 64, default: 'store' })
  acquiredFrom: string;

  @Column({ name: 'payload', type: 'jsonb', default: () => "'{}'" })
  payload: Record<string, unknown>;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn({ name: 'acquired_at', type: 'timestamptz' })
  acquiredAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
