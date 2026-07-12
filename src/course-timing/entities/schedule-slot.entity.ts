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
import { Lesson } from '../../roadmaps/entities/lesson.entity';
import {
  ReminderStatus,
  ScheduleSlotSource,
  ScheduleSlotStatus,
} from '../timing.constants';
import { CourseSchedule } from './course-schedule.entity';

@Entity('schedule_slots')
@Index(['scheduleId', 'localDate'])
@Index(['userId', 'startsAtUtc'])
export class ScheduleSlot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'schedule_id', type: 'uuid' })
  scheduleId: string;

  @ManyToOne(() => CourseSchedule, (s) => s.slots, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schedule_id' })
  schedule: CourseSchedule;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'local_date', type: 'date' })
  localDate: string;

  @Column({ name: 'start_local_time', type: 'varchar', length: 5 })
  startLocalTime: string;

  @Column({ name: 'end_local_time', type: 'varchar', length: 5 })
  endLocalTime: string;

  @Column({ name: 'starts_at_utc', type: 'timestamptz' })
  startsAtUtc: Date;

  @Column({ name: 'ends_at_utc', type: 'timestamptz' })
  endsAtUtc: Date;

  @Column({ name: 'planned_minutes', type: 'int' })
  plannedMinutes: number;

  @Column({ name: 'lesson_id', type: 'uuid', nullable: true })
  lessonId: string | null;

  @ManyToOne(() => Lesson, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'lesson_id' })
  lesson: Lesson | null;

  @Column({ name: 'weekly_task_id', type: 'uuid', nullable: true })
  weeklyTaskId: string | null;

  @Column({
    type: 'enum',
    enum: ScheduleSlotStatus,
    default: ScheduleSlotStatus.Planned,
  })
  status: ScheduleSlotStatus;

  @Column({
    type: 'enum',
    enum: ScheduleSlotSource,
    default: ScheduleSlotSource.Questionnaire,
  })
  source: ScheduleSlotSource;

  @Column({
    name: 'reminder_status',
    type: 'enum',
    enum: ReminderStatus,
    default: ReminderStatus.Pending,
  })
  reminderStatus: ReminderStatus;

  @Column({ type: 'varchar', nullable: true })
  title: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
