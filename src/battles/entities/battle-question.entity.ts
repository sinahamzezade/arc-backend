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
import { Battle } from './battle.entity';

@Entity('battle_questions')
@Unique(['battleId', 'orderIndex'])
@Index(['battleId', 'round'])
export class BattleQuestion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'battle_id', type: 'uuid' })
  battleId: string;

  @ManyToOne(() => Battle, (b) => b.questions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'battle_id' })
  battle: Battle;

  @Column({ type: 'int', default: 1 })
  round: number;

  @Column({ name: 'order_index', type: 'int' })
  orderIndex: number;

  @Column({ name: 'is_sudden_death', type: 'boolean', default: false })
  isSuddenDeath: boolean;

  @Column({ name: 'question_template_id', type: 'uuid' })
  questionTemplateId: string;

  @Column({ name: 'question_version_id', type: 'uuid' })
  questionVersionId: string;

  @Column({ type: 'jsonb' })
  prompt: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  options: Array<{ id: string; label: string }>;

  /** Server-only grading payload. Never serialized to clients until reveal. */
  @Column({ name: 'correct_option_ids', type: 'jsonb' })
  correctOptionIds: string[];

  @Column({ type: 'text', default: '' })
  explanation: string;

  @Column({ type: 'varchar', length: 16 })
  difficulty: string;

  @Column({ name: 'time_limit_ms', type: 'int' })
  timeLimitMs: number;

  @Column({ name: 'opened_at', type: 'timestamptz', nullable: true })
  openedAt: Date | null;

  @Column({ name: 'revealed_at', type: 'timestamptz', nullable: true })
  revealedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
