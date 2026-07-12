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
  LeagueRegionalBucket,
  LeagueSeasonStatus,
} from './league.enums';
import { LeagueCohort } from './league-cohort.entity';

@Entity('league_seasons')
@Index(['regionalBucket', 'startsAt'], { unique: true })
export class LeagueSeason {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'regional_bucket',
    type: 'enum',
    enum: LeagueRegionalBucket,
  })
  regionalBucket: LeagueRegionalBucket;

  @Column({ name: 'season_timezone', type: 'varchar', length: 64 })
  seasonTimezone: string;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt: Date;

  @Column({
    type: 'enum',
    enum: LeagueSeasonStatus,
    default: LeagueSeasonStatus.Forming,
  })
  status: LeagueSeasonStatus;

  /** Snapshot of promote/demote/cohort rules at season open */
  @Column({ name: 'config_snapshot', type: 'jsonb', default: {} })
  configSnapshot: Record<string, unknown>;

  @OneToMany(() => LeagueCohort, (cohort) => cohort.season)
  cohorts: LeagueCohort[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
