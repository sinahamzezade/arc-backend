import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('rank_unlock_history')
@Index(['userId', 'newRankLevel'], { unique: true })
export class RankUnlockHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'old_rank_level', type: 'int' })
  oldRankLevel: number;

  @Column({ name: 'old_rank_slug', type: 'varchar', length: 64 })
  oldRankSlug: string;

  @Column({ name: 'new_rank_level', type: 'int' })
  newRankLevel: number;

  @Column({ name: 'new_rank_slug', type: 'varchar', length: 64 })
  newRankSlug: string;

  @Column({ name: 'xp_snapshot', type: 'int', default: 0 })
  xpSnapshot: number;

  @Column({ name: 'gate_snapshot', type: 'jsonb', default: () => "'{}'" })
  gateSnapshot: Record<string, unknown>;

  @Column({ name: 'reward_transaction_id', type: 'uuid', nullable: true })
  rewardTransactionId: string | null;

  @CreateDateColumn({ name: 'unlocked_at', type: 'timestamptz' })
  unlockedAt: Date;
}
