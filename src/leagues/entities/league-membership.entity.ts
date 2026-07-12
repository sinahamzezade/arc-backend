import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import {
  LeaguePrivacyState,
  LeaguePromotionResult,
} from './league.enums';
import { LeagueCohort } from './league-cohort.entity';
import { LeagueScoreEvent } from './league-score-event.entity';

@Entity('league_memberships')
@Index(['cohortId', 'userId'], { unique: true })
@Index(['userId', 'joinedAt'])
export class LeagueMembership {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'cohort_id', type: 'uuid' })
  cohortId: string;

  @ManyToOne(() => LeagueCohort, (cohort) => cohort.memberships, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'cohort_id' })
  cohort: LeagueCohort;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'starting_rank', type: 'int', default: 0 })
  startingRank: number;

  @Column({ name: 'qualified_xp', type: 'int', default: 0 })
  qualifiedXp: number;

  @Column({ name: 'proof_weighted_xp', type: 'int', default: 0 })
  proofWeightedXp: number;

  @Column({ name: 'active_days', type: 'int', default: 0 })
  activeDays: number;

  /** Distinct local dates with score events, JSON string array */
  @Column({ name: 'active_day_keys', type: 'jsonb', default: [] })
  activeDayKeys: string[];

  @Column({ name: 'position', type: 'int', nullable: true })
  position: number | null;

  @Column({
    name: 'promotion_result',
    type: 'enum',
    enum: LeaguePromotionResult,
    nullable: true,
  })
  promotionResult: LeaguePromotionResult | null;

  @Column({
    name: 'privacy_state',
    type: 'enum',
    enum: LeaguePrivacyState,
    default: LeaguePrivacyState.Visible,
  })
  privacyState: LeaguePrivacyState;

  @Column({ name: 'joined_at', type: 'timestamptz' })
  joinedAt: Date;

  @Column({ name: 'last_score_event_at', type: 'timestamptz', nullable: true })
  lastScoreEventAt: Date | null;

  /** UTC ms when final XP total was first reached */
  @Column({ name: 'final_xp_reached_at', type: 'timestamptz', nullable: true })
  finalXpReachedAt: Date | null;

  @OneToMany(() => LeagueScoreEvent, (e) => e.membership)
  scoreEvents: LeagueScoreEvent[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
