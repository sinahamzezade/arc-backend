export enum LeagueTier {
  Bronze = 'bronze',
  Silver = 'silver',
  Gold = 'gold',
  Platinum = 'platinum',
  Diamond = 'diamond',
  Master = 'master',
}

export enum LeagueDivision {
  III = 'III',
  II = 'II',
  I = 'I',
}

export enum LeagueRegionalBucket {
  Europe = 'europe',
  Americas = 'americas',
  Apac = 'apac',
  MiddleEastAfrica = 'middle_east_africa',
}

export enum LeagueSeasonStatus {
  Forming = 'forming',
  Active = 'active',
  Finalizing = 'finalizing',
  Finalized = 'finalized',
}

export enum LeagueCohortStatus {
  Forming = 'forming',
  Active = 'active',
  LateStart = 'late_start',
  Inactive = 'inactive',
  Finalizing = 'finalizing',
  Finalized = 'finalized',
}

export enum LeaguePromotionResult {
  Promoted = 'promoted',
  Remained = 'remained',
  Demoted = 'demoted',
  GateBlocked = 'gate_blocked',
  Inactive = 'inactive',
}

export enum LeaguePrivacyState {
  Visible = 'visible',
  Hidden = 'hidden',
  Anonymized = 'anonymized',
}

export enum LeagueScoreSourceType {
  Lesson = 'lesson',
  Quiz = 'quiz',
  Practice = 'practice',
  Assessment = 'assessment',
  Challenge = 'challenge',
  Project = 'project',
  Battle = 'battle',
  WeeklySeal = 'weekly_seal',
}
