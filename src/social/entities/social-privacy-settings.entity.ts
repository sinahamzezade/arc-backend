import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum ProfileVisibility {
  Public = 'public',
  Followers = 'followers',
  Friends = 'friends',
  Private = 'private',
}

export enum InviteFromPolicy {
  Friends = 'friends',
  Followers = 'followers',
  Nobody = 'nobody',
}

@Entity('social_privacy_settings')
export class SocialPrivacySettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    name: 'profile_visibility',
    type: 'varchar',
    length: 16,
    default: ProfileVisibility.Public,
  })
  profileVisibility: ProfileVisibility;

  @Column({ name: 'show_weekly_xp', type: 'boolean', default: true })
  showWeeklyXp: boolean;

  @Column({ name: 'show_streak', type: 'boolean', default: false })
  showStreak: boolean;

  @Column({ name: 'show_current_lesson', type: 'boolean', default: false })
  showCurrentLesson: boolean;

  @Column({ name: 'show_battle_history', type: 'boolean', default: true })
  showBattleHistory: boolean;

  @Column({ name: 'show_study_activity', type: 'boolean', default: true })
  showStudyActivity: boolean;

  @Column({ name: 'allow_friend_requests', type: 'boolean', default: true })
  allowFriendRequests: boolean;

  @Column({ name: 'allow_follows', type: 'boolean', default: true })
  allowFollows: boolean;

  @Column({
    name: 'allow_battle_invites_from',
    type: 'varchar',
    length: 16,
    default: InviteFromPolicy.Friends,
  })
  allowBattleInvitesFrom: InviteFromPolicy;

  @Column({
    name: 'allow_study_invites_from',
    type: 'varchar',
    length: 16,
    default: InviteFromPolicy.Friends,
  })
  allowStudyInvitesFrom: InviteFromPolicy;

  @Column({ name: 'leaderboard_visible', type: 'boolean', default: true })
  leaderboardVisible: boolean;

  @Column({ name: 'hide_from_suggestions', type: 'boolean', default: false })
  hideFromSuggestions: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
