import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Lesson } from './lesson.entity';

export enum LessonProgressStatus {
  NotStarted = 'not_started',
  InProgress = 'in_progress',
  Completed = 'completed',
}

@Entity('lesson_progress')
@Unique(['userId', 'lessonId'])
export class LessonProgress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'lesson_id', type: 'uuid' })
  lessonId: string;

  @ManyToOne(() => Lesson, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lesson_id' })
  lesson: Lesson;

  @Column({
    type: 'enum',
    enum: LessonProgressStatus,
    default: LessonProgressStatus.NotStarted,
  })
  status: LessonProgressStatus;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'time_spent_minutes', type: 'int', default: 0 })
  timeSpentMinutes: number;

  @Column({ name: 'xp_awarded', type: 'int', default: 0 })
  xpAwarded: number;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount: number;

  @Column({
    name: 'session_state',
    type: 'jsonb',
    default: () => "'{}'",
  })
  sessionState: {
    contentStep?: number;
    practiceDone?: boolean;
    /** Keyed by question id (q0..); option index for mcq, boolean otherwise. */
    quizAnswers?: Record<string, number | boolean>;
    quizIndex?: number;
    /** Resolved active-format block ids → correctness. */
    activeBlockResolutions?: Record<
      string,
      { correct: boolean; resolvedAt: string }
    >;
  };

  @Column({ name: 'gems_awarded', type: 'int', default: 0 })
  gemsAwarded: number;

  @Column({ name: 'coins_awarded', type: 'int', default: 0 })
  coinsAwarded: number;

  @Column({ name: 'quiz_correct', type: 'int', nullable: true })
  quizCorrect: number | null;

  @Column({ name: 'quiz_total', type: 'int', nullable: true })
  quizTotal: number | null;

  @Column({ name: 'practice_correct', type: 'boolean', nullable: true })
  practiceCorrect: boolean | null;

  @Column({ name: 'active_attempt_id', type: 'uuid', nullable: true })
  activeAttemptId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
