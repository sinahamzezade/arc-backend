import { Profile } from '../profiles/entities/profile.entity';
import { User } from '../users/entities/user.entity';

export function toUserDto(user: User) {
  const hasPassword = Boolean(user.passwordHash);
  const changedAt = user.passwordLastChangedAt ?? (hasPassword ? user.createdAt : null);
  return {
    id: user.id,
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    createdAt: user.createdAt?.toISOString?.() ?? undefined,
    hasPassword,
    passwordLastChangedAt: changedAt?.toISOString?.() ?? null,
  };
}

export function toAuthUserDto(user: User) {
  return {
    id: user.id,
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
  };
}

export function toProfileDto(profile: Profile, includeRewards = false) {
  const base = {
    id: profile.id,
    displayName: profile.displayName,
    username: profile.username,
    avatarUrl: profile.avatarUrl,
    timezone: profile.timezone,
    language: profile.language,
    currentRole: profile.currentRole,
    targetRole: profile.targetRole,
    yearsExperience: profile.yearsExperience,
    questionnaireStatus: profile.questionnaireStatus ?? 'not_started',
    questionnaireCompletedAt:
      profile.questionnaireCompletedAt?.toISOString?.() ?? null,
    onboardingCompletedAt:
      profile.onboardingCompletedAt?.toISOString?.() ?? null,
  };

  if (!includeRewards) {
    return base;
  }

  return {
    ...base,
    totalXp: profile.totalXp,
    coins: profile.coins,
    gems: profile.gems,
    weeklyStreak: profile.weeklyStreak,
  };
}
