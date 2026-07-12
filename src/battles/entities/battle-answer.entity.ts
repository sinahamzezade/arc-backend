import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { BattleParticipant } from './battle-participant.entity';
import { BattleQuestion } from './battle-question.entity';

@Entity('battle_answers')
@Unique(['participantId', 'battleQuestionId'])
@Unique(['idempotencyKey'])
@Index(['battleQuestionId'])
export class BattleAnswer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'participant_id', type: 'uuid' })
  participantId: string;

  @ManyToOne(() => BattleParticipant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'participant_id' })
  participant: BattleParticipant;

  @Column({ name: 'battle_question_id', type: 'uuid' })
  battleQuestionId: string;

  @ManyToOne(() => BattleQuestion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'battle_question_id' })
  battleQuestion: BattleQuestion;

  @Column({ name: 'selected_option_id', type: 'varchar', length: 64, nullable: true })
  selectedOptionId: string | null;

  @Column({ name: 'is_correct', type: 'boolean', default: false })
  isCorrect: boolean;

  @Column({ name: 'response_ms', type: 'int', default: 0 })
  responseMs: number;

  @Column({ name: 'correctness_points', type: 'int', default: 0 })
  correctnessPoints: number;

  @Column({ name: 'speed_bonus', type: 'int', default: 0 })
  speedBonus: number;

  @Column({ name: 'difficulty_bonus', type: 'int', default: 0 })
  difficultyBonus: number;

  @Column({ name: 'streak_bonus', type: 'int', default: 0 })
  streakBonus: number;

  @Column({ name: 'question_score', type: 'int', default: 0 })
  questionScore: number;

  @Column({ name: 'timed_out', type: 'boolean', default: false })
  timedOut: boolean;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey: string;

  @Column({ name: 'submitted_at', type: 'timestamptz' })
  submittedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
