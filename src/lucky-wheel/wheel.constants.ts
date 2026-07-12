export const WHEEL_SEGMENT_COUNT = 6;
export const WHEEL_DAILY_GEMS_CAP = 15;
export const WHEEL_DAILY_XP_CAP = 25;
export const WHEEL_RESPIN_GEM_PRICE = 25;
export const WHEEL_DEFAULT_SLUG = 'daily-lucky-wheel';
export const WHEEL_FALLBACK_REWARD_KEY = 'coins_50';

export const SEGMENT_COLORS = [
  '#FFD233',
  '#6B4EFF',
  '#FF4D2D',
  '#FFD233',
  '#6B4EFF',
  '#FF4D2D',
] as const;

/** Default six-segment layout weights — lucky_wheel.md §6 */
export const DEFAULT_SEGMENT_SEED = [
  {
    rewardKey: 'gems_10',
    rewardType: 'gems' as const,
    label: '10 Gems',
    amount: 10,
    weight: 14,
    sortOrder: 0,
  },
  {
    rewardKey: 'xp_25',
    rewardType: 'lifetime_xp' as const,
    label: '25 Lifetime XP',
    amount: 25,
    weight: 18,
    sortOrder: 1,
  },
  {
    rewardKey: 'coins_100',
    rewardType: 'coins' as const,
    label: '100 Coins',
    amount: 100,
    weight: 18,
    sortOrder: 2,
  },
  {
    rewardKey: 'try_again',
    rewardType: 'try_again' as const,
    label: 'Try Again',
    amount: 0,
    weight: 12,
    sortOrder: 3,
    replacementRewardKey: 'coins_50',
  },
  {
    rewardKey: 'lucky_badge',
    rewardType: 'badge' as const,
    label: 'Lucky Badge',
    amount: 1,
    weight: 8,
    sortOrder: 4,
    allowDuplicateOnLayout: false,
    replacementRewardKey: 'coins_100',
    payload: { badgeId: 'lucky-wheel', badgeLabel: 'Lucky Wheel' },
  },
  {
    rewardKey: 'coins_50',
    rewardType: 'coins' as const,
    label: '50 Coins',
    amount: 50,
    weight: 30,
    sortOrder: 5,
  },
] as const;
