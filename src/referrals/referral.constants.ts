export enum ReferralCodeStatus {
  Active = 'active',
  Rotated = 'rotated',
  Revoked = 'revoked',
}

export enum ReferralLinkStatus {
  Active = 'active',
  Revoked = 'revoked',
}

export enum ReferralAttributionStatus {
  Registered = 'registered',
  EmailVerified = 'email_verified',
  OnboardingCompleted = 'onboarding_completed',
  AlmostThere = 'almost_there',
  Qualified = 'qualified',
  Rewarded = 'rewarded',
  Expired = 'expired',
  Rejected = 'rejected',
  UnderReview = 'under_review',
}

export enum ReferralRewardGrantStatus {
  Pending = 'pending',
  Held = 'held',
  Granted = 'granted',
  Reversed = 'reversed',
}

export enum ReferralShareChannel {
  Whatsapp = 'whatsapp',
  Telegram = 'telegram',
  Sms = 'sms',
  Email = 'email',
  CopyLink = 'copy_link',
  NativeShare = 'native_share',
  Facebook = 'facebook',
  X = 'x',
  Linkedin = 'linkedin',
  Other = 'other',
}

export const REFERRAL_COOKIE = 'arc_ref';
export const REFERRAL_COOKIE_TTL_DAYS = 30;
export const REFERRAL_QUALIFY_WINDOW_DAYS = 30;
export const REFERRAL_MANUAL_CLAIM_HOURS = 24;
export const REFERRAL_CODE_ROTATE_COOLDOWN_DAYS = 30;
export const REFERRAL_MIN_STUDY_MINUTES = 5;

export const REFERRAL_INVITER_COINS = 300;
export const REFERRAL_FRIEND_COINS = 150;
export const REFERRAL_FRIEND_XP = 50;

export const REFERRAL_MILESTONES: Array<{
  qualifiedRequired: number;
  coins: number;
  gems: number;
  badge?: string;
}> = [
  { qualifiedRequired: 3, coins: 300, gems: 0 },
  { qualifiedRequired: 5, coins: 750, gems: 10, badge: 'Connector' },
  { qualifiedRequired: 10, coins: 1500, gems: 25, badge: 'Violet Connector Frame' },
  { qualifiedRequired: 25, coins: 4000, gems: 50, badge: 'Arlo Ambassador' },
];

export function publicAppBase(configUrl?: string): string {
  return (configUrl || 'http://localhost:3000').replace(/\/$/, '');
}
