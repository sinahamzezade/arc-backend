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

@Entity('notification_preferences')
export class NotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'in_app_enabled', type: 'boolean', default: true })
  inAppEnabled: boolean;

  @Column({ name: 'push_enabled', type: 'boolean', default: true })
  pushEnabled: boolean;

  @Column({ name: 'email_digests_enabled', type: 'boolean', default: true })
  emailDigestsEnabled: boolean;

  @Column({ name: 'learning_reminders_enabled', type: 'boolean', default: true })
  learningRemindersEnabled: boolean;

  @Column({ name: 'weekly_progress_enabled', type: 'boolean', default: true })
  weeklyProgressEnabled: boolean;

  @Column({ name: 'streak_reminders_enabled', type: 'boolean', default: true })
  streakRemindersEnabled: boolean;

  @Column({ name: 'rewards_enabled', type: 'boolean', default: true })
  rewardsEnabled: boolean;

  @Column({ name: 'social_enabled', type: 'boolean', default: true })
  socialEnabled: boolean;

  @Column({
    name: 'study_together_invites_enabled',
    type: 'boolean',
    default: true,
  })
  studyTogetherInvitesEnabled: boolean;

  @Column({ name: 'battle_invites_enabled', type: 'boolean', default: true })
  battleInvitesEnabled: boolean;

  @Column({ name: 'league_updates_enabled', type: 'boolean', default: true })
  leagueUpdatesEnabled: boolean;

  @Column({ name: 'lucky_wheel_enabled', type: 'boolean', default: true })
  luckyWheelEnabled: boolean;

  @Column({ name: 'coach_messages_enabled', type: 'boolean', default: true })
  coachMessagesEnabled: boolean;

  @Column({ name: 'product_updates_enabled', type: 'boolean', default: false })
  productUpdatesEnabled: boolean;

  @Column({ name: 'timezone_snapshot', type: 'varchar', length: 64, nullable: true })
  timezoneSnapshot: string | null;

  /** Local quiet-hour start HH:mm (default 22:00). */
  @Column({ name: 'quiet_hours_start', type: 'varchar', length: 5, default: '22:00' })
  quietHoursStart: string;

  /** Local quiet-hour end HH:mm (default 08:00). */
  @Column({ name: 'quiet_hours_end', type: 'varchar', length: 5, default: '08:00' })
  quietHoursEnd: string;

  @Column({ name: 'quiet_hours_enabled', type: 'boolean', default: true })
  quietHoursEnabled: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
