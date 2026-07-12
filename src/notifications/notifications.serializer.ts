import { NotificationPreference } from './entities/notification-preference.entity';
import { Notification } from './entities/notification.entity';
import type { PreferenceToggleId } from './notifications.constants';

export function toPreferencesDto(prefs: NotificationPreference) {
  return {
    push: prefs.pushEnabled,
    email: prefs.emailDigestsEnabled,
    learningReminders: prefs.learningRemindersEnabled,
    weeklyProgress: prefs.weeklyProgressEnabled,
    streakReminders: prefs.streakRemindersEnabled,
    rewards: prefs.rewardsEnabled,
    social: prefs.socialEnabled,
    studyTogetherInvites: prefs.studyTogetherInvitesEnabled,
    battleInvites: prefs.battleInvitesEnabled,
    leagueUpdates: prefs.leagueUpdatesEnabled,
    luckyWheel: prefs.luckyWheelEnabled,
    coachMessages: prefs.coachMessagesEnabled,
    marketing: prefs.productUpdatesEnabled,
    quietHoursEnabled: prefs.quietHoursEnabled,
    quietHoursStart: prefs.quietHoursStart,
    quietHoursEnd: prefs.quietHoursEnd,
  };
}

export function toPreferenceTogglesDto(prefs: NotificationPreference) {
  const values = toPreferencesDto(prefs);
  return [
    {
      id: 'push' as const,
      label: 'Push notifications',
      detail: 'Streak, battles, league cuts',
      on: values.push,
    },
    {
      id: 'email' as const,
      label: 'Email digests',
      detail: 'Weekly progress summary',
      on: values.email,
    },
    {
      id: 'learningReminders' as const,
      label: 'Learning reminders',
      detail: 'Study windows & missed sessions',
      on: values.learningReminders,
    },
    {
      id: 'weeklyProgress' as const,
      label: 'Weekly progress',
      detail: 'Recap & pace nudges',
      on: values.weeklyProgress,
    },
    {
      id: 'streakReminders' as const,
      label: 'Streak reminders',
      detail: 'Nudge before day ends',
      on: values.streakReminders,
    },
    {
      id: 'rewards' as const,
      label: 'Rewards',
      detail: 'XP, badges, chests',
      on: values.rewards,
    },
    {
      id: 'social' as const,
      label: 'Social',
      detail: 'Friends & follows',
      on: values.social,
    },
    {
      id: 'studyTogetherInvites' as const,
      label: 'Study Together',
      detail: 'Invites & session pings',
      on: values.studyTogetherInvites,
    },
    {
      id: 'battleInvites' as const,
      label: 'Battle invites',
      detail: 'Friends can ping you live',
      on: values.battleInvites,
    },
    {
      id: 'leagueUpdates' as const,
      label: 'League updates',
      detail: 'Cuts, promotes, risks',
      on: values.leagueUpdates,
    },
    {
      id: 'luckyWheel' as const,
      label: 'Lucky wheel',
      detail: 'Ready & reward alerts',
      on: values.luckyWheel,
    },
    {
      id: 'coachMessages' as const,
      label: 'Coach messages',
      detail: 'Arlo tips & recovery',
      on: values.coachMessages,
    },
    {
      id: 'marketing' as const,
      label: 'Product updates',
      detail: 'New features & tips',
      on: values.marketing,
    },
  ] satisfies Array<{
    id: PreferenceToggleId;
    label: string;
    detail: string;
    on: boolean;
  }>;
}

export function toNotificationDto(n: Notification) {
  return {
    id: n.id,
    type: n.type,
    category: n.category,
    title: n.title,
    body: n.body,
    actionUrl: n.actionUrl,
    payload: n.payload,
    priority: n.priority,
    unread: n.readAt === null,
    readAt: n.readAt?.toISOString() ?? null,
    expiresAt: n.expiresAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString(
    'base64url',
  );
}

export function decodeCursor(
  cursor: string,
): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const [iso, id] = raw.split('|');
    if (!iso || !id) return null;
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
