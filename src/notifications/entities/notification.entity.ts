import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum NotificationCategory {
  Streak = 'streak',
  Coach = 'coach',
  Social = 'social',
  Rewards = 'rewards',
  System = 'system',
}

export enum NotificationType {
  StudyReminder = 'study_reminder',
  StreakRisk = 'streak_risk',
  WeeklyRecap = 'weekly_recap',
  MissedWeekRecovery = 'missed_week_recovery',
  BadgeUnlocked = 'badge_unlocked',
  ReplanSuggestion = 'replan_suggestion',
  BattleInvite = 'battle_invite',
  LeagueUpdate = 'league_update',
  Referral = 'referral',
  ProductUpdate = 'product_update',
  CoachMessage = 'coach_message',
  System = 'system',
}

export enum NotificationChannel {
  InApp = 'in_app',
  Push = 'push',
  Email = 'email',
}

@Entity('notifications')
@Index(['userId', 'createdAt'])
@Index(['userId', 'readAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @Column({ type: 'enum', enum: NotificationCategory })
  category: NotificationCategory;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ type: 'varchar', length: 500 })
  body: string;

  @Column({ name: 'action_url', type: 'varchar', length: 512, nullable: true })
  actionUrl: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({
    type: 'enum',
    enum: NotificationChannel,
    array: true,
    default: '{in_app}',
  })
  channels: NotificationChannel[];

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
