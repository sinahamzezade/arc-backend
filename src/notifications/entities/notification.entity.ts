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
  Learning = 'learning',
  Streak = 'streak',
  Coach = 'coach',
  Social = 'social',
  Rewards = 'rewards',
  System = 'system',
}

export enum NotificationType {
  StudyReminder = 'study_reminder',
  StudyStarting = 'study_starting',
  MissedSession = 'missed_session',
  ReplanSuggestion = 'replan_suggestion',
  DeadlineRisk = 'deadline_risk',
  PaceAhead = 'pace_ahead',
  PaceBehind = 'pace_behind',
  StreakRisk = 'streak_risk',
  StreakProtected = 'streak_protected',
  StreakBroken = 'streak_broken',
  StreakRecovered = 'streak_recovered',
  WeeklyRecap = 'weekly_recap',
  MissedWeekRecovery = 'missed_week_recovery',
  RewardGranted = 'reward_granted',
  BadgeUnlocked = 'badge_unlocked',
  RankClose = 'rank_close',
  RankUnlocked = 'rank_unlocked',
  RankGateCompleted = 'rank_gate_completed',
  ChestReady = 'chest_ready',
  LuckyWheelReady = 'lucky_wheel_ready',
  LuckyWheelReward = 'lucky_wheel_reward',
  FriendRequest = 'friend_request',
  FriendRequestAccepted = 'friend_request_accepted',
  NewFollower = 'new_follower',
  StudyInvite = 'study_invite',
  StudyInviteAccepted = 'study_invite_accepted',
  StudySessionStarting = 'study_session_starting',
  StudyPartnerReady = 'study_partner_ready',
  StudySessionCompleted = 'study_session_completed',
  StudySessionMissed = 'study_session_missed',
  BattleInvite = 'battle_invite',
  BattleInviteExpiring = 'battle_invite_expiring',
  BattleAccepted = 'battle_accepted',
  BattleStarting = 'battle_starting',
  BattleResult = 'battle_result',
  BattleRematch = 'battle_rematch',
  LeagueUpdate = 'league_update',
  LeagueStarted = 'league_started',
  LeaguePositionChanged = 'league_position_changed',
  LeaguePromotionRisk = 'league_promotion_risk',
  LeagueDemoteRisk = 'league_demote_risk',
  LeaguePositionRisk = 'league_position_risk',
  LeagueFinalized = 'league_finalized',
  LeaguePromoted = 'league_promoted',
  LeagueDemoted = 'league_demoted',
  LeagueGateBlocked = 'league_gate_blocked',
  Referral = 'referral',
  ProductUpdate = 'product_update',
  CoachMessage = 'coach_message',
  System = 'system',
  Security = 'security',
}

export enum NotificationChannel {
  InApp = 'in_app',
  Push = 'push',
  Email = 'email',
}

export enum NotificationPriority {
  Low = 'low',
  Normal = 'normal',
  High = 'high',
  Critical = 'critical',
}

@Entity('notifications')
@Index(['userId', 'createdAt'])
@Index(['userId', 'readAt'])
@Index(['userId', 'dedupeKey'], {
  unique: true,
  where: '"dedupe_key" IS NOT NULL',
})
@Index(['userId', 'sourceEventId', 'type'], {
  unique: true,
  where: '"source_event_id" IS NOT NULL',
})
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

  @Column({ name: 'source_event_id', type: 'uuid', nullable: true })
  sourceEventId: string | null;

  @Column({ name: 'dedupe_key', type: 'varchar', length: 160, nullable: true })
  dedupeKey: string | null;

  @Column({
    type: 'enum',
    enum: NotificationPriority,
    default: NotificationPriority.Normal,
  })
  priority: NotificationPriority;

  @Column({
    type: 'enum',
    enum: NotificationChannel,
    array: true,
    default: '{in_app}',
  })
  channels: NotificationChannel[];

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'hidden_at', type: 'timestamptz', nullable: true })
  hiddenAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
