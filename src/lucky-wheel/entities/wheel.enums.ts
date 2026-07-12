export enum WheelCampaignStatus {
  Draft = 'draft',
  Active = 'active',
  Paused = 'paused',
  Ended = 'ended',
}

export enum WheelTimezonePolicy {
  UserLocal = 'user_local',
  Utc = 'utc',
  CampaignZone = 'campaign_zone',
}

export enum WheelRewardType {
  Coins = 'coins',
  Gems = 'gems',
  LifetimeXp = 'lifetime_xp',
  InventoryItem = 'inventory_item',
  StreakFreeze = 'streak_freeze',
  Badge = 'badge',
  ExtraSpin = 'extra_spin',
  TryAgain = 'try_again',
}

export enum WheelEntitlementType {
  Free = 'free',
  Extra = 'extra',
  GemRespin = 'gem_respin',
}

export enum WheelSpinStatus {
  Reserved = 'reserved',
  Awarded = 'awarded',
  Failed = 'failed',
  Reversed = 'reversed',
}
