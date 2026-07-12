import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PaceState } from '../timing.constants';
import { CourseSchedule } from './course-schedule.entity';

@Entity('pace_snapshots')
@Index(['scheduleId', 'snapshotDate'], { unique: true })
export class PaceSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'schedule_id', type: 'uuid' })
  scheduleId: string;

  @ManyToOne(() => CourseSchedule, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schedule_id' })
  schedule: CourseSchedule;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'snapshot_date', type: 'date' })
  snapshotDate: string;

  @Column({ name: 'planned_minutes', type: 'int', default: 0 })
  plannedMinutes: number;

  @Column({ name: 'completed_minutes', type: 'int', default: 0 })
  completedMinutes: number;

  @Column({ name: 'active_days', type: 'int', default: 0 })
  activeDays: number;

  @Column({ name: 'completion_velocity', type: 'numeric', precision: 8, scale: 3, default: 0 })
  completionVelocity: string;

  @Column({ name: 'estimate_accuracy', type: 'numeric', precision: 6, scale: 3, nullable: true })
  estimateAccuracy: string | null;

  @Column({ name: 'effective_minutes_per_week', type: 'int', default: 0 })
  effectiveMinutesPerWeek: number;

  @Column({ name: 'estimated_completion_date', type: 'date', nullable: true })
  estimatedCompletionDate: string | null;

  @Column({
    name: 'pace_state',
    type: 'enum',
    enum: PaceState,
    default: PaceState.OnTrack,
  })
  paceState: PaceState;

  @Column({ type: 'varchar', nullable: true })
  reason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
