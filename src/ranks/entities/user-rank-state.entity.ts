import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('user_rank_states')
export class UserRankState {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'current_rank_level', type: 'int', default: 1 })
  currentRankLevel: number;

  @Column({ name: 'current_rank_slug', type: 'varchar', length: 64, default: 'curious-egg' })
  currentRankSlug: string;

  @Column({ name: 'highest_rank_level', type: 'int', default: 1 })
  highestRankLevel: number;

  @Column({ name: 'evaluated_xp', type: 'int', default: 0 })
  evaluatedXp: number;

  @Column({ name: 'evaluated_at', type: 'timestamptz', nullable: true })
  evaluatedAt: Date | null;

  @Column({ name: 'next_evaluation_reason', type: 'varchar', length: 128, nullable: true })
  nextEvaluationReason: string | null;

  /** Distinct local learning-day keys (YYYY-MM-DD). */
  @Column({ name: 'active_day_keys', type: 'jsonb', default: () => "'[]'" })
  activeDayKeys: string[];

  @Column({ name: 'active_days', type: 'int', default: 0 })
  activeDays: number;

  /** Milestone counters keyed by gate type. */
  @Column({ name: 'progress_counters', type: 'jsonb', default: () => "'{}'" })
  progressCounters: Record<string, number>;

  @Column({ name: 'evaluation_held', type: 'boolean', default: false })
  evaluationHeld: boolean;

  @Column({ name: 'hold_reason', type: 'varchar', length: 256, nullable: true })
  holdReason: string | null;

  @Column({ name: 'hide_from_profile', type: 'boolean', default: false })
  hideFromProfile: boolean;

  @Column({ name: 'rank_close_notified_level', type: 'int', nullable: true })
  rankCloseNotifiedLevel: number | null;

  @VersionColumn()
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
