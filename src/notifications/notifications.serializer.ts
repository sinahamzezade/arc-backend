import { NotificationPreference } from './entities/notification-preference.entity';
import { Notification } from './entities/notification.entity';
import type { PreferenceToggleId } from './notifications.constants';

export function toPreferencesDto(prefs: NotificationPreference) {
  return {
    push: prefs.pushEnabled,
    email: prefs.emailDigestsEnabled,
    streakReminders: prefs.streakRemindersEnabled,
    battleInvites: prefs.battleInvitesEnabled,
    marketing: prefs.productUpdatesEnabled,
  } satisfies Record<PreferenceToggleId, boolean>;
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
      id: 'streakReminders' as const,
      label: 'Streak reminders',
      detail: 'Nudge before day ends',
      on: values.streakReminders,
    },
    {
      id: 'battleInvites' as const,
      label: 'Battle invites',
      detail: 'Friends can ping you live',
      on: values.battleInvites,
    },
    {
      id: 'marketing' as const,
      label: 'Product updates',
      detail: 'New features & tips',
      on: values.marketing,
    },
  ];
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
    unread: n.readAt === null,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}
