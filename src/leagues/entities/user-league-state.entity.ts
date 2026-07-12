import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import {
  LeagueDivision,
  LeagueRegionalBucket,
  LeagueTier,
} from './league.enums';

/**
 * Sticky placement between seasons. Rank gates + weekly seals live here
 * until ranking/gamification modules own them.
 */
@Entity('user_league_states')
export class UserLeagueState {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    type: 'enum',
    enum: LeagueTier,
    default: LeagueTier.Bronze,
  })
  tier: LeagueTier;

  @Column({
    type: 'enum',
    enum: LeagueDivision,
    default: LeagueDivision.III,
  })
  division: LeagueDivision;

  /** Lifetime rank level used for tier entry gates */
  @Column({ name: 'rank_level', type: 'int', default: 1 })
  rankLevel: number;

  @Column({ name: 'weekly_seals', type: 'int', default: 0 })
  weeklySeals: number;

  @Column({
    name: 'regional_bucket',
    type: 'enum',
    enum: LeagueRegionalBucket,
    nullable: true,
  })
  regionalBucket: LeagueRegionalBucket | null;

  /** Sticky for current season — timezone changes do not move mid-season */
  @Column({ name: 'season_timezone', type: 'varchar', length: 64, nullable: true })
  seasonTimezone: string | null;

  @Column({ name: 'current_season_id', type: 'uuid', nullable: true })
  currentSeasonId: string | null;

  @Column({ name: 'current_membership_id', type: 'uuid', nullable: true })
  currentMembershipId: string | null;

  @Column({ name: 'empty_seasons', type: 'int', default: 0 })
  emptySeasons: number;

  @Column({ name: 'is_inactive', type: 'boolean', default: false })
  isInactive: boolean;

  @Column({ name: 'hide_from_profile', type: 'boolean', default: false })
  hideFromProfile: boolean;

  @Column({ name: 'recent_qualified_xp', type: 'int', default: 0 })
  recentQualifiedXp: number;

  @Column({ name: 'last_risk_notify_at', type: 'timestamptz', nullable: true })
  lastRiskNotifyAt: Date | null;

  @Column({ name: 'last_position_notify_at', type: 'timestamptz', nullable: true })
  lastPositionNotifyAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
