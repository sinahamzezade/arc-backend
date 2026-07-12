import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { WheelUserDay } from './wheel-user-day.entity';
import { WheelEntitlementType, WheelSpinStatus } from './wheel.enums';

@Entity('wheel_spins')
@Unique(['userId', 'idempotencyKey'])
@Index(['userDayId'])
export class WheelSpin {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_day_id', type: 'uuid' })
  userDayId: string;

  @ManyToOne(() => WheelUserDay, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_day_id' })
  userDay: WheelUserDay;

  @Column({ name: 'spin_number', type: 'int' })
  spinNumber: number;

  @Column({
    name: 'entitlement_type',
    type: 'enum',
    enum: WheelEntitlementType,
  })
  entitlementType: WheelEntitlementType;

  @Column({ name: 'winning_segment_id', type: 'varchar', length: 64 })
  winningSegmentId: string;

  @Column({ name: 'landing_index', type: 'int' })
  landingIndex: number;

  @Column({ name: 'reward_key', type: 'varchar', length: 64 })
  rewardKey: string;

  @Column({ name: 'reward_snapshot', type: 'jsonb', default: () => "'{}'" })
  rewardSnapshot: Record<string, unknown>;

  @Column({ name: 'rng_value', type: 'numeric', precision: 12, scale: 8 })
  rngValue: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey: string;

  @Column({ name: 'ledger_transaction_id', type: 'uuid', nullable: true })
  ledgerTransactionId: string | null;

  @Column({
    type: 'enum',
    enum: WheelSpinStatus,
    default: WheelSpinStatus.Reserved,
  })
  status: WheelSpinStatus;

  @Column({ name: 'replacement_reason', type: 'varchar', nullable: true })
  replacementReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
