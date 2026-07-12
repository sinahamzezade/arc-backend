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
  BattleDifficulty,
  BattleMode,
  BattleResultReason,
  BattleStatus,
} from '../battle.constants';
import { BattleParticipant } from './battle-participant.entity';
import { BattleQuestion } from './battle-question.entity';

@Entity('battles')
@Index(['challengerId', 'status'])
@Index(['opponentId', 'status'])
@Index(['status', 'inviteExpiresAt'])
export class Battle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'challenger_id', type: 'uuid' })
  challengerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'challenger_id' })
  challenger: User;

  @Column({ name: 'opponent_id', type: 'uuid' })
  opponentId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'opponent_id' })
  opponent: User;

  @Column({ type: 'varchar', length: 64 })
  subject: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  topic: string | null;

  @Column({ type: 'varchar', length: 16 })
  difficulty: BattleDifficulty;

  @Column({ type: 'varchar', length: 16 })
  mode: BattleMode;

  @Column({ name: 'question_count', type: 'int' })
  questionCount: number;

  @Column({ name: 'seconds_per_question', type: 'int' })
  secondsPerQuestion: number;

  @Column({ name: 'stake_per_player', type: 'int' })
  stakePerPlayer: number;

  @Column({ type: 'varchar', length: 24, default: BattleStatus.Draft })
  status: BattleStatus;

  @Column({ name: 'invite_expires_at', type: 'timestamptz', nullable: true })
  inviteExpiresAt: Date | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Column({ name: 'play_expires_at', type: 'timestamptz', nullable: true })
  playExpiresAt: Date | null;

  @Column({ name: 'current_round', type: 'int', default: 0 })
  currentRound: number;

  @Column({ name: 'winner_id', type: 'uuid', nullable: true })
  winnerId: string | null;

  @Column({ name: 'challenger_score', type: 'int', default: 0 })
  challengerScore: number;

  @Column({ name: 'opponent_score', type: 'int', default: 0 })
  opponentScore: number;

  @Column({
    name: 'result_reason',
    type: 'varchar',
    length: 24,
    nullable: true,
  })
  resultReason: BattleResultReason | null;

  @Column({ name: 'question_set_version', type: 'int', default: 1 })
  questionSetVersion: number;

  @Column({ name: 'risk_status', type: 'varchar', length: 24, default: 'clear' })
  riskStatus: string;

  @Column({ name: 'sudden_death_count', type: 'int', default: 0 })
  suddenDeathCount: number;

  @Column({ name: 'create_idempotency_key', type: 'varchar', length: 64 })
  createIdempotencyKey: string;

  @OneToMany(() => BattleParticipant, (p) => p.battle)
  participants: BattleParticipant[];

  @OneToMany(() => BattleQuestion, (q) => q.battle)
  questions: BattleQuestion[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
