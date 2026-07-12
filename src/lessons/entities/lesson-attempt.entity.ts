import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Lesson } from '../../roadmaps/entities/lesson.entity';
import { LessonProgress } from '../../roadmaps/entities/lesson-progress.entity';

export enum LessonAttemptStatus {
  InProgress = 'in_progress',
  Submitted = 'submitted',
  Completed = 'completed',
  Abandoned = 'abandoned',
}

@Entity('lesson_attempts')
export class LessonAttempt {
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

  @Column({ name: 'lesson_progress_id', type: 'uuid', nullable: true })
  lessonProgressId: string | null;

  @ManyToOne(() => LessonProgress, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'lesson_progress_id' })
  lessonProgress: LessonProgress | null;

  @Column({ name: 'attempt_number', type: 'int', default: 1 })
  attemptNumber: number;

  @Column({ name: 'content_version_id', type: 'varchar', length: 64 })
  contentVersionId: string;

  @Column({ name: 'content_schema_version', type: 'int', default: 1 })
  contentSchemaVersion: number;

  @Column({ name: 'reward_rule_version', type: 'varchar', length: 64 })
  rewardRuleVersion: string;

  @Column({
    type: 'enum',
    enum: LessonAttemptStatus,
    default: LessonAttemptStatus.InProgress,
  })
  status: LessonAttemptStatus;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({
    name: 'assistance_used',
    type: 'jsonb',
    default: () => "'{}'",
  })
  assistanceUsed: Record<string, unknown>;

  @Column({
    name: 'score_snapshot',
    type: 'jsonb',
    nullable: true,
  })
  scoreSnapshot: {
    quizCorrect?: number;
    quizTotal?: number;
    practiceCorrect?: boolean | null;
    scorePercent?: number;
  } | null;

  @Column({ name: 'reward_eligible', type: 'boolean', default: true })
  rewardEligible: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
