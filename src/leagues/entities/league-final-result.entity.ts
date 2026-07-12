import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import {
  LeagueDivision,
  LeaguePromotionResult,
  LeagueTier,
} from './league.enums';
import { LeagueCohort } from './league-cohort.entity';
import { LeagueSeason } from './league-season.entity';

@Entity('league_final_results')
@Index(['seasonId', 'userId'], { unique: true })
@Index(['cohortId', 'finalPosition'])
export class LeagueFinalResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'season_id', type: 'uuid' })
  seasonId: string;

  @ManyToOne(() => LeagueSeason, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'season_id' })
  season: LeagueSeason;

  @Column({ name: 'cohort_id', type: 'uuid' })
  cohortId: string;

  @ManyToOne(() => LeagueCohort, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cohort_id' })
  cohort: LeagueCohort;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'membership_id', type: 'uuid' })
  membershipId: string;

  @Column({ name: 'final_position', type: 'int' })
  finalPosition: number;

  @Column({ name: 'final_xp', type: 'int' })
  finalXp: number;

  @Column({ name: 'tie_break_snapshot', type: 'jsonb', default: {} })
  tieBreakSnapshot: Record<string, unknown>;

  @Column({ name: 'old_tier', type: 'enum', enum: LeagueTier })
  oldTier: LeagueTier;

  @Column({ name: 'old_division', type: 'enum', enum: LeagueDivision })
  oldDivision: LeagueDivision;

  @Column({ name: 'new_tier', type: 'enum', enum: LeagueTier })
  newTier: LeagueTier;

  @Column({ name: 'new_division', type: 'enum', enum: LeagueDivision })
  newDivision: LeagueDivision;

  @Column({
    name: 'promotion_result',
    type: 'enum',
    enum: LeaguePromotionResult,
  })
  promotionResult: LeaguePromotionResult;

  @Column({ name: 'reward_transaction_id', type: 'uuid', nullable: true })
  rewardTransactionId: string | null;

  @Column({ name: 'reward_snapshot', type: 'jsonb', default: {} })
  rewardSnapshot: Record<string, unknown>;

  @Column({ name: 'notification_status', type: 'varchar', default: 'pending' })
  notificationStatus: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
