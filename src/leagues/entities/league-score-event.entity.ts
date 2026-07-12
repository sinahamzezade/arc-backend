import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LeagueScoreSourceType } from './league.enums';
import { LeagueMembership } from './league-membership.entity';

@Entity('league_score_events')
@Index(['ledgerEntryId'], { unique: true })
@Index(['membershipId', 'occurredAt'])
export class LeagueScoreEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'membership_id', type: 'uuid' })
  membershipId: string;

  @ManyToOne(() => LeagueMembership, (m) => m.scoreEvents, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'membership_id' })
  membership: LeagueMembership;

  /** Gamification reward_ledger_entries.id — unique per season ingest */
  @Column({ name: 'ledger_entry_id', type: 'uuid' })
  ledgerEntryId: string;

  @Column({ name: 'xp_delta', type: 'int' })
  xpDelta: number;

  @Column({
    name: 'source_type',
    type: 'enum',
    enum: LeagueScoreSourceType,
  })
  sourceType: LeagueScoreSourceType;

  @Column({ name: 'source_id', type: 'uuid', nullable: true })
  sourceId: string | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;

  @Column({ type: 'bigint' })
  sequence: string;

  @Column({ name: 'is_proof_weighted', type: 'boolean', default: false })
  isProofWeighted: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
