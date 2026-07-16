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

export const CALL_INVITE_TIMEOUT_MS = 90_000;
export const CALL_TURN_TTL_SEC = 3600;
export const CALL_INVITE_RATE_LIMIT = 8;
export const CALL_INVITE_RATE_WINDOW_SEC = 60;
export const CALL_IN_CALL_TTL_SEC = 60 * 60; // 1h safety
/** Connecting without becoming active → treat as failed (ICE / client drop). */
export const CALL_CONNECTING_STALE_MS = 2 * 60_000;
/**
 * Last socket gone — wait before ending ringing/connecting.
 * Covers Socket.IO polling→websocket upgrade + brief tab remounts.
 * Without this, a single-tab callee (outside chat) loses the invite.
 */
export const CALL_DISCONNECT_GRACE_MS = 12_000;
