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

export type RemediationOutcome =
  | 'served'
  | 'recovered'
  | 'failed_again'
  | 'budget_exhausted';

/**
 * Append-only remediation analytics (§16.3).
 * UNIQUE(attempt_id, concept_tag, round) → idempotent under duplicate checks.
 */
@Entity('remediation_events')
@Unique(['attemptId', 'conceptTag', 'round'])
export class RemediationEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'attempt_id', type: 'uuid' })
  attemptId: string;

  @ManyToOne(() => LessonAttempt, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'attempt_id' })
  attempt: LessonAttempt;

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

  @Column({ name: 'concept_tag', type: 'text' })
  conceptTag: string;

  /** Practice/quiz item that was failed. */
  @Column({ name: 'trigger_item_id', type: 'text' })
  triggerItemId: string;

  /** Recovery item served; null if explanation-only. */
  @Column({ name: 'recovery_item_id', type: 'text', nullable: true })
  recoveryItemId: string | null;

  /** 1-based remediation round for this concept in this attempt. */
  @Column({ type: 'int' })
  round: number;

  @Column({ type: 'text' })
  outcome: RemediationOutcome;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
