import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { BattleParticipantRole } from '../battle.constants';
import { Battle } from './battle.entity';

@Entity('battle_participants')
@Unique(['battleId', 'userId'])
@Index(['userId', 'battleId'])
export class BattleParticipant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'battle_id', type: 'uuid' })
  battleId: string;

  @ManyToOne(() => Battle, (b) => b.participants, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'battle_id' })
  battle: Battle;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 16 })
  role: BattleParticipantRole;

  @Column({ type: 'int', default: 0 })
  score: number;

  @Column({ name: 'correct_count', type: 'int', default: 0 })
  correctCount: number;

  @Column({ name: 'hard_expert_correct', type: 'int', default: 0 })
  hardExpertCorrect: number;

  @Column({ name: 'total_answer_ms', type: 'int', default: 0 })
  totalAnswerMs: number;

  @Column({ name: 'answer_count', type: 'int', default: 0 })
  answerCount: number;

  @Column({ name: 'correct_streak', type: 'int', default: 0 })
  correctStreak: number;

  @Column({ name: 'is_ready', type: 'boolean', default: false })
  isReady: boolean;

  @Column({
    name: 'connection_state',
    type: 'varchar',
    length: 16,
    default: 'offline',
  })
  connectionState: string;

  @Column({ name: 'last_heartbeat_at', type: 'timestamptz', nullable: true })
  lastHeartbeatAt: Date | null;

  @Column({ name: 'disconnect_warnings', type: 'int', default: 0 })
  disconnectWarnings: number;

  @Column({ name: 'forfeited', type: 'boolean', default: false })
  forfeited: boolean;

  @Column({ name: 'final_placement', type: 'int', nullable: true })
  finalPlacement: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
