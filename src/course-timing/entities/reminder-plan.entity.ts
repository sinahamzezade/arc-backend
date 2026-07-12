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
import { NotificationType } from '../../notifications/entities/notification.entity';
import { ReminderStatus } from '../timing.constants';
import { CourseSchedule } from './course-schedule.entity';
import { ScheduleSlot } from './schedule-slot.entity';

@Entity('reminder_plans')
@Index(['userId', 'dedupeKey'], { unique: true })
export class ReminderPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'schedule_id', type: 'uuid' })
  scheduleId: string;

  @ManyToOne(() => CourseSchedule, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schedule_id' })
  schedule: CourseSchedule;

  @Column({ name: 'slot_id', type: 'uuid', nullable: true })
  slotId: string | null;

  @ManyToOne(() => ScheduleSlot, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'slot_id' })
  slot: ScheduleSlot | null;

  @Column({ name: 'schedule_version', type: 'int' })
  scheduleVersion: number;

  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @Column({ name: 'fire_at', type: 'timestamptz' })
  fireAt: Date;

  @Column({
    type: 'enum',
    enum: ReminderStatus,
    default: ReminderStatus.Pending,
  })
  status: ReminderStatus;

  @Column({ name: 'dedupe_key', type: 'varchar', length: 180 })
  dedupeKey: string;

  @Column({ name: 'notification_schedule_id', type: 'uuid', nullable: true })
  notificationScheduleId: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  payload: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
