import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../../users/entities/user.entity';
import type { LlmPurpose } from '../llm.types';

@Entity('llm_usage_events')
export class LlmUsageEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  purpose: LlmPurpose;

  @Column({ type: 'varchar', length: 128 })
  model: string;

  @Column({ name: 'prompt_tokens', type: 'int', default: 0 })
  promptTokens: number;

  @Column({ name: 'completion_tokens', type: 'int', default: 0 })
  completionTokens: number;

  @Column({ name: 'total_tokens', type: 'int', default: 0 })
  totalTokens: number;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata: Record<string, unknown>;

  @Index()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
