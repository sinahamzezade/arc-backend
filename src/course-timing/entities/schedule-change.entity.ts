import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ScheduleChangeActor } from '../timing.constants';
import { CourseSchedule } from './course-schedule.entity';

@Entity('schedule_changes')
@Index(['scheduleId'])
export class ScheduleChange {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'schedule_id', type: 'uuid' })
  scheduleId: string;

  @ManyToOne(() => CourseSchedule, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'schedule_id' })
  schedule: CourseSchedule;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'old_version', type: 'int' })
  oldVersion: number;

  @Column({ name: 'new_version', type: 'int' })
  newVersion: number;

  @Column({
    type: 'enum',
    enum: ScheduleChangeActor,
    default: ScheduleChangeActor.System,
  })
  actor: ScheduleChangeActor;

  @Column({ type: 'varchar' })
  reason: string;

  @Column({ name: 'changed_fields', type: 'jsonb', default: () => "'{}'" })
  changedFields: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
