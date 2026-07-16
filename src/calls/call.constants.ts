export enum CallMode {
  Audio = 'audio',
  Video = 'video',
}

export enum CallState {
  Ringing = 'ringing',
  Connecting = 'connecting',
  Active = 'active',
  Ended = 'ended',
}

export enum CallEndReason {
  Completed = 'completed',
  Declined = 'declined',
  Missed = 'missed',
  Busy = 'busy',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

export const CALL_INVITE_TIMEOUT_MS = 45_000;
export const CALL_TURN_TTL_SEC = 300;
export const CALL_INVITE_RATE_LIMIT = 8;
export const CALL_INVITE_RATE_WINDOW_SEC = 60;
export const CALL_IN_CALL_TTL_SEC = 60 * 60; // 1h safety
/** Connecting without becoming active → treat as failed (ICE / client drop). */
export const CALL_CONNECTING_STALE_MS = 2 * 60_000;
