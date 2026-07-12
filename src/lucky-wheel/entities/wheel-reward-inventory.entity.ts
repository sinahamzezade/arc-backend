import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('wheel_reward_inventory')
@Index(['rewardKey'], { unique: true })
export class WheelRewardInventory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'reward_key', type: 'varchar', length: 64 })
  rewardKey: string;

  @Column({ name: 'total_quantity', type: 'int' })
  totalQuantity: number;

  @Column({ name: 'reserved_quantity', type: 'int', default: 0 })
  reservedQuantity: number;

  @Column({ name: 'awarded_quantity', type: 'int', default: 0 })
  awardedQuantity: number;

  @Column({ name: 'available_from', type: 'timestamptz', nullable: true })
  availableFrom: Date | null;

  @Column({ name: 'available_until', type: 'timestamptz', nullable: true })
  availableUntil: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
