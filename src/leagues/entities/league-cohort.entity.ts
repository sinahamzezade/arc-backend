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
import {
  LeagueCohortStatus,
  LeagueDivision,
  LeagueTier,
} from './league.enums';
import { LeagueSeason } from './league-season.entity';
import { LeagueMembership } from './league-membership.entity';

@Entity('league_cohorts')
@Index(['seasonId', 'tier', 'division', 'status'])
export class LeagueCohort {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'season_id', type: 'uuid' })
  seasonId: string;

  @ManyToOne(() => LeagueSeason, (season) => season.cohorts, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'season_id' })
  season: LeagueSeason;

  @Column({ type: 'enum', enum: LeagueTier })
  tier: LeagueTier;

  @Column({ type: 'enum', enum: LeagueDivision })
  division: LeagueDivision;

  @Column({ name: 'max_members', type: 'int', default: 30 })
  maxMembers: number;

  @Column({ name: 'seed_metadata', type: 'jsonb', default: {} })
  seedMetadata: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: LeagueCohortStatus,
    default: LeagueCohortStatus.Forming,
  })
  status: LeagueCohortStatus;

  @OneToMany(() => LeagueMembership, (m) => m.cohort)
  memberships: LeagueMembership[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
