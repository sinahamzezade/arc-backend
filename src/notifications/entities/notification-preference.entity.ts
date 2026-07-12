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

  /** Master switch for push delivery (streak, battles, league). */
  @Column({ name: 'push_enabled', type: 'boolean', default: true })
  pushEnabled: boolean;

  /** Weekly progress email digests. */
  @Column({ name: 'email_digests_enabled', type: 'boolean', default: true })
  emailDigestsEnabled: boolean;

  /** Nudge before day ends / streak risk. */
  @Column({ name: 'streak_reminders_enabled', type: 'boolean', default: true })
  streakRemindersEnabled: boolean;

  /** Live battle invite pings. */
  @Column({ name: 'battle_invites_enabled', type: 'boolean', default: true })
  battleInvitesEnabled: boolean;

  /** Product updates / tips (opt-in). */
  @Column({ name: 'product_updates_enabled', type: 'boolean', default: false })
  productUpdatesEnabled: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
