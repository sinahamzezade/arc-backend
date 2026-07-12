import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('streak_states')
export class StreakState {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'daily_streak', type: 'int', default: 0 })
  dailyStreak: number;

  @Column({ name: 'weekly_streak', type: 'int', default: 0 })
  weeklyStreak: number;

  @Column({ name: 'longest_daily_streak', type: 'int', default: 0 })
  longestDailyStreak: number;

  @Column({ name: 'last_qualified_day', type: 'date', nullable: true })
  lastQualifiedDay: string | null;

  @Column({ name: 'recovery_window_ends_at', type: 'timestamptz', nullable: true })
  recoveryWindowEndsAt: Date | null;

  @Column({ name: 'consecutive_protected_days', type: 'int', default: 0 })
  consecutiveProtectedDays: number;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
