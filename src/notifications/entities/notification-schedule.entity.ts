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
import { NotificationType } from './notification.entity';

export enum NotificationScheduleStatus {
  Scheduled = 'scheduled',
  Queued = 'queued',
  Sent = 'sent',
  Cancelled = 'cancelled',
  Stale = 'stale',
  Failed = 'failed',
}

@Entity('notification_schedules')
@Index(['userId', 'dedupeKey'], { unique: true, where: '"dedupe_key" IS NOT NULL' })
export class NotificationSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @Column({ type: 'varchar', length: 64, nullable: true })
  topic: string | null;

  @Column({ name: 'scheduled_at', type: 'timestamptz' })
  scheduledAt: Date;

  @Column({ name: 'timezone_snapshot', type: 'varchar', length: 64, nullable: true })
  timezoneSnapshot: string | null;

  @Column({ name: 'schedule_version', type: 'int', default: 1 })
  scheduleVersion: number;

  @Column({ name: 'source_entity_id', type: 'uuid', nullable: true })
  sourceEntityId: string | null;

  @Column({ name: 'dedupe_key', type: 'varchar', length: 160, nullable: true })
  dedupeKey: string | null;

  @Column({
    type: 'enum',
    enum: NotificationScheduleStatus,
    default: NotificationScheduleStatus.Scheduled,
  })
  status: NotificationScheduleStatus;

  @Column({ name: 'cancellation_reason', type: 'varchar', nullable: true })
  cancellationReason: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  payload: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
