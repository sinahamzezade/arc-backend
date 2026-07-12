import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Roadmap } from '../../roadmaps/entities/roadmap.entity';
import { User } from '../../users/entities/user.entity';
import {
  FeasibilityState,
  PaceState,
} from '../timing.constants';
import { ScheduleSlot } from './schedule-slot.entity';

@Entity('course_schedules')
@Index(['roadmapId', 'scheduleVersion'], { unique: true })
@Index(['userId', 'roadmapId'])
export class CourseSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'roadmap_id', type: 'uuid' })
  roadmapId: string;

  @ManyToOne(() => Roadmap, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roadmap_id' })
  roadmap: Roadmap;

  @Column({ name: 'commitment_id', type: 'uuid' })
  commitmentId: string;

  @Column({ name: 'schedule_version', type: 'int', default: 1 })
  scheduleVersion: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'target_completion_date', type: 'date', nullable: true })
  targetCompletionDate: string | null;

  @Column({ name: 'estimated_completion_date', type: 'date', nullable: true })
  estimatedCompletionDate: string | null;

  @Column({ name: 'total_required_minutes', type: 'int', default: 0 })
  totalRequiredMinutes: number;

  @Column({ name: 'completed_minutes', type: 'int', default: 0 })
  completedMinutes: number;

  @Column({ name: 'remaining_minutes', type: 'int', default: 0 })
  remainingMinutes: number;

  @Column({ name: 'planned_minutes_per_week', type: 'int', default: 0 })
  plannedMinutesPerWeek: number;

  @Column({ name: 'effective_minutes_per_week', type: 'int', default: 0 })
  effectiveMinutesPerWeek: number;

  @Column({
    name: 'pace_state',
    type: 'enum',
    enum: PaceState,
    default: PaceState.OnTrack,
  })
  paceState: PaceState;

  @Column({
    name: 'feasibility_state',
    type: 'enum',
    enum: FeasibilityState,
    default: FeasibilityState.Feasible,
  })
  feasibilityState: FeasibilityState;

  @Column({ name: 'feasibility_ratio', type: 'numeric', precision: 6, scale: 3, default: 1 })
  feasibilityRatio: string;

  @Column({ name: 'active_window_start', type: 'date' })
  activeWindowStart: string;

  @Column({ name: 'active_window_end', type: 'date' })
  activeWindowEnd: string;

  @Column({ name: 'replan_lock', type: 'boolean', default: false })
  replanLock: boolean;

  @Column({ name: 'generated_at', type: 'timestamptz' })
  generatedAt: Date;

  @OneToMany(() => ScheduleSlot, (s) => s.schedule)
  slots: ScheduleSlot[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
