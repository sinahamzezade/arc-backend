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
import { User } from '../../users/entities/user.entity';
import { Lesson } from '../../roadmaps/entities/lesson.entity';
import { LessonAttempt } from './lesson-attempt.entity';

@Entity('lesson_completion_results')
@Unique(['userId', 'idempotencyKey'])
export class LessonCompletionResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index()
  @Column({ name: 'lesson_id', type: 'uuid' })
  lessonId: string;

  @ManyToOne(() => Lesson, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lesson_id' })
  lesson: Lesson;

  @Column({ name: 'attempt_id', type: 'uuid', nullable: true })
  attemptId: string | null;

  @ManyToOne(() => LessonAttempt, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'attempt_id' })
  attempt: LessonAttempt | null;

  @Column({ name: 'lesson_progress_id', type: 'uuid', nullable: true })
  lessonProgressId: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey: string;

  @Column({ name: 'reward_transaction_group_id', type: 'uuid', nullable: true })
  rewardTransactionGroupId: string | null;

  @Column({ name: 'content_version_id', type: 'varchar', length: 64 })
  contentVersionId: string;

  @Column({ name: 'reward_rule_version', type: 'varchar', length: 64 })
  rewardRuleVersion: string;

  /** Full API response snapshot for idempotent replay. */
  @Column({ name: 'result_snapshot', type: 'jsonb' })
  resultSnapshot: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
