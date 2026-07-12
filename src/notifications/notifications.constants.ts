import {
  NotificationCategory,
  NotificationType,
} from './entities/notification.entity';

/** Settings UI toggle ids — keep in sync with arc-app settings mock. */
export const PreferenceToggleIds = [
  'push',
  'email',
  'streakReminders',
  'battleInvites',
  'marketing',
] as const;

export type PreferenceToggleId = (typeof PreferenceToggleIds)[number];

export const DEFAULT_PREFERENCES: Record<PreferenceToggleId, boolean> = {
  push: true,
  email: true,
  streakReminders: true,
  battleInvites: true,
  marketing: false,
};

export const TYPE_CATEGORY: Record<NotificationType, NotificationCategory> = {
  [NotificationType.StudyReminder]: NotificationCategory.Streak,
  [NotificationType.StreakRisk]: NotificationCategory.Streak,
  [NotificationType.WeeklyRecap]: NotificationCategory.System,
  [NotificationType.MissedWeekRecovery]: NotificationCategory.Coach,
  [NotificationType.BadgeUnlocked]: NotificationCategory.Rewards,
  [NotificationType.ReplanSuggestion]: NotificationCategory.Coach,
  [NotificationType.BattleInvite]: NotificationCategory.Social,
  [NotificationType.LeagueUpdate]: NotificationCategory.Social,
  [NotificationType.Referral]: NotificationCategory.Social,
  [NotificationType.ProductUpdate]: NotificationCategory.System,
  [NotificationType.CoachMessage]: NotificationCategory.Coach,
  [NotificationType.System]: NotificationCategory.System,
};

/** Which preference gate blocks creating this notification type. */
export const TYPE_PREFERENCE_GATE: Partial<
  Record<NotificationType, PreferenceToggleId>
> = {
  [NotificationType.StudyReminder]: 'streakReminders',
  [NotificationType.StreakRisk]: 'streakReminders',
  [NotificationType.BattleInvite]: 'battleInvites',
  [NotificationType.ProductUpdate]: 'marketing',
};
