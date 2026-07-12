export enum BattleStatus {
  Draft = 'draft',
  Invited = 'invited',
  Accepted = 'accepted',
  Funding = 'funding',
  Ready = 'ready',
  InProgress = 'in_progress',
  SuddenDeath = 'sudden_death',
  Completed = 'completed',
  Declined = 'declined',
  Expired = 'expired',
  Cancelled = 'cancelled',
  Forfeited = 'forfeited',
  Voided = 'voided',
  Refunded = 'refunded',
}

export enum BattleMode {
  Live = 'live',
  Async = 'async',
}

export enum BattleDifficulty {
  Easy = 'easy',
  Medium = 'medium',
  Hard = 'hard',
  Expert = 'expert',
  Mixed = 'mixed',
}

export enum BattleParticipantRole {
  Challenger = 'challenger',
  Opponent = 'opponent',
}

export enum BattleEscrowStatus {
  Reserved = 'reserved',
  Captured = 'captured',
  Refunded = 'refunded',
  Released = 'released',
}

export enum BattleEventType {
  Invite = 'invite',
  Accepted = 'accepted',
  PlayerReady = 'player_ready',
  QuestionOpened = 'question_opened',
  AnswerSubmitted = 'answer_submitted',
  Reveal = 'reveal',
  ScoreChanged = 'score_changed',
  Disconnect = 'disconnect',
  SuddenDeath = 'sudden_death',
  Result = 'result',
}

export enum BattleResultReason {
  Score = 'score',
  SuddenDeath = 'sudden_death',
  Tiebreakers = 'tiebreakers',
  Draw = 'draw',
  Forfeit = 'forfeit',
  Void = 'void',
  Cancelled = 'cancelled',
}

export const BATTLE_QUESTION_COUNTS = [5, 10, 15, 20] as const;
export const BATTLE_SECONDS_OPTIONS = [15, 30, 45, 60] as const;
export const BATTLE_STAKE_PRESETS = [50, 100, 250, 500] as const;

export const BATTLE_LIVE_INVITE_TTL_MS = 30 * 60 * 1000;
export const BATTLE_ASYNC_INVITE_TTL_MS = 24 * 60 * 60 * 1000;
export const BATTLE_ASYNC_PLAY_TTL_MS = 24 * 60 * 60 * 1000;
export const BATTLE_SUDDEN_DEATH_MAX = 5;

export const BATTLE_HEARTBEAT_MS = 5_000;
export const BATTLE_DISCONNECT_GRACE_MS = 15_000;
export const BATTLE_DISCONNECT_FORFEIT_MS = 60_000;

/** Max stake per player by rank level band. */
export function maxStakeForRankLevel(rankLevel: number): number {
  if (rankLevel >= 10) return 1_000;
  if (rankLevel >= 7) return 500;
  if (rankLevel >= 5) return 250;
  return 100;
}

export const BATTLE_DIFFICULTY_BONUS: Record<string, number> = {
  easy: 0,
  medium: 5,
  hard: 10,
  expert: 20,
};

export const BATTLE_COMPLETION_XP = 5;
export const BATTLE_CORRECT_XP = 2;
export const BATTLE_WIN_XP = 10;
export const BATTLE_PERFECT_XP = 10;
export const BATTLE_PARTICIPATION_COINS = 10;
export const BATTLE_PARTICIPATION_COINS_DAILY_CAP = 3;
/** Same pair battles/day before Battle XP is zeroed (anti-farm). */
export const BATTLE_PAIR_XP_DAILY_CAP = 3;
/** Max qualified Battle League XP credited per user per UTC day. */
export const BATTLE_LEAGUE_XP_DAILY_CAP = 100;
/** Notify invite expiring when this fraction of TTL remains. */
export const BATTLE_INVITE_EXPIRING_REMAINING_RATIO = 0.2;
