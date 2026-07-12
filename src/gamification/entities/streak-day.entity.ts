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

export enum StreakDayStatus {
  Completed = 'completed',
  Protected = 'protected',
  Missed = 'missed',
  Recovered = 'recovered',
}

@Entity('streak_days')
@Unique(['userId', 'localDate'])
@Index(['userId', 'localDate'])
export class StreakDay {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'local_date', type: 'date' })
  localDate: string;

  @Column({
    type: 'enum',
    enum: StreakDayStatus,
    default: StreakDayStatus.Completed,
  })
  status: StreakDayStatus;

  @Column({ name: 'qualifying_action_type', type: 'varchar', nullable: true })
  qualifyingActionType: string | null;

  @Column({ name: 'qualifying_action_id', type: 'uuid', nullable: true })
  qualifyingActionId: string | null;

  @Column({ name: 'freeze_inventory_id', type: 'uuid', nullable: true })
  freezeInventoryId: string | null;

  @Column({ name: 'timezone_snapshot', type: 'varchar', length: 64, nullable: true })
  timezoneSnapshot: string | null;

  @Column({ name: 'day_start_at', type: 'timestamptz', nullable: true })
  dayStartAt: Date | null;

  @Column({ name: 'day_end_at', type: 'timestamptz', nullable: true })
  dayEndAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
