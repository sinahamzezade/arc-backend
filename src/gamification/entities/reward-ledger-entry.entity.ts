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

export enum RewardCurrency {
  LifetimeXp = 'lifetime_xp',
  LeagueXp = 'league_xp',
  Gems = 'gems',
  Coins = 'coins',
}

export enum RewardReasonType {
  Lesson = 'lesson',
  Quiz = 'quiz',
  Project = 'project',
  Wheel = 'wheel',
  Battle = 'battle',
  Store = 'store',
  Streak = 'streak',
  WeeklySeal = 'weekly_seal',
  Rank = 'rank',
  Referral = 'referral',
  StudyTogether = 'study_together',
  Admin = 'admin',
}

@Entity('reward_ledger_entries')
@Unique(['userId', 'idempotencyKey'])
export class RewardLedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'enum', enum: RewardCurrency })
  currency: RewardCurrency;

  @Column({ type: 'int' })
  amount: number;

  @Column({ name: 'reason_type', type: 'enum', enum: RewardReasonType })
  reasonType: RewardReasonType;

  @Column({ name: 'reason_id', type: 'uuid', nullable: true })
  reasonId: string | null;

  @Index()
  @Column({ name: 'transaction_group_id', type: 'uuid' })
  transactionGroupId: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey: string;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
