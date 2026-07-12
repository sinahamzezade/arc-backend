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
import { Goal } from '../../goals/entities/goal.entity';
import { Roadmap } from '../../roadmaps/entities/roadmap.entity';
import { User } from '../../users/entities/user.entity';
import { CommitmentStatus } from '../timing.constants';

@Entity('learning_commitments')
@Index(['userId', 'goalId'], { unique: true })
export class LearningCommitment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'goal_id', type: 'uuid' })
  goalId: string;

  @ManyToOne(() => Goal, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'goal_id' })
  goal: Goal;

  @Column({ name: 'roadmap_id', type: 'uuid', nullable: true })
  roadmapId: string | null;

  @ManyToOne(() => Roadmap, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'roadmap_id' })
  roadmap: Roadmap | null;

  @Column({ type: 'varchar', length: 64, default: 'UTC' })
  timezone: string;

  @Column({ name: 'weekly_hours_token', type: 'varchar', nullable: true })
  weeklyHoursToken: string | null;

  @Column({ name: 'target_minutes_per_week', type: 'int' })
  targetMinutesPerWeek: number;

  @Column({ name: 'available_days', type: 'jsonb', default: () => "'[]'" })
  availableDays: string[];

  @Column({ name: 'time_windows', type: 'jsonb', default: () => "'[]'" })
  timeWindows: string[];

  @Column({ name: 'deadline_token', type: 'varchar', nullable: true })
  deadlineToken: string | null;

  @Column({ name: 'requested_completion_date', type: 'date', nullable: true })
  requestedCompletionDate: string | null;

  @Column({ name: 'reminder_lead_minutes', type: 'int', default: 30 })
  reminderLeadMinutes: number;

  @Column({ name: 'quiet_hours_start', type: 'varchar', length: 5, default: '22:00' })
  quietHoursStart: string;

  @Column({ name: 'quiet_hours_end', type: 'varchar', length: 5, default: '08:00' })
  quietHoursEnd: string;

  @Column({ name: 'quiet_hours_enabled', type: 'boolean', default: true })
  quietHoursEnabled: boolean;

  @Column({
    type: 'enum',
    enum: CommitmentStatus,
    default: CommitmentStatus.Active,
  })
  status: CommitmentStatus;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ name: 'timezone_changed_at', type: 'timestamptz', nullable: true })
  timezoneChangedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
