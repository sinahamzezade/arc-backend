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
import { ReferralRewardGrantStatus } from '../referral.constants';
import { ReferralAttribution } from './referral-attribution.entity';

@Entity('referral_reward_grants')
@Unique(['idempotencyKey'])
@Index(['attributionId'])
export class ReferralRewardGrant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'attribution_id', type: 'uuid', nullable: true })
  attributionId: string | null;

  @ManyToOne(() => ReferralAttribution, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'attribution_id' })
  attribution: ReferralAttribution | null;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'coins', type: 'int', default: 0 })
  coins: number;

  @Column({ name: 'gems', type: 'int', default: 0 })
  gems: number;

  @Column({ name: 'xp', type: 'int', default: 0 })
  xp: number;

  @Column({
    type: 'varchar',
    length: 16,
    default: ReferralRewardGrantStatus.Pending,
  })
  status: ReferralRewardGrantStatus;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 96 })
  idempotencyKey: string;

  @Column({ name: 'kind', type: 'varchar', length: 32 })
  kind: string;

  @Column({
    name: 'ledger_transaction_group_id',
    type: 'uuid',
    nullable: true,
  })
  ledgerTransactionGroupId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
