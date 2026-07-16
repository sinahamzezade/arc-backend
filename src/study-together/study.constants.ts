export enum StudySessionStatus {
  Draft = 'draft',
  Invited = 'invited',
  Accepted = 'accepted',
  Waiting = 'waiting',
  Active = 'active',
  Completed = 'completed',
  Declined = 'declined',
  Expired = 'expired',
  Cancelled = 'cancelled',
  Abandoned = 'abandoned',
  PartiallyCompleted = 'partially_completed',
  Voided = 'voided',
}

export enum StudyStartMode {
  Now = 'now',
  Within1Hour = 'within_1_hour',
  Scheduled = 'scheduled',
}

export enum StudySubject {
  Sql = 'SQL',
  Python = 'Python',
  Excel = 'Excel',
  DataAnalysis = 'Data Analysis',
  CurrentTrack = 'current_track',
  Any = 'Any',
}

export enum StudyParticipantRole {
  Creator = 'creator',
  Invitee = 'invitee',
}

export enum StudyInvitationStatus {
  Pending = 'pending',
  Accepted = 'accepted',
  Declined = 'declined',
  Cancelled = 'cancelled',
  Expired = 'expired',
}

export enum StudyCompletionOutcome {
  CompletedByBoth = 'completed_by_both',
  CompletedByCreatorOnly = 'completed_by_creator_only',
  CompletedByInviteeOnly = 'completed_by_invitee_only',
  Abandoned = 'abandoned',
  Voided = 'voided',
  None = 'none',
}

export enum StudySessionMode {
  Focus = 'focus',
  ReadTogether = 'read_together',
}

export enum StudyEventType {
  InviteSent = 'invite_sent',
  Accepted = 'accepted',
  Declined = 'declined',
  Cancelled = 'cancelled',
  Joined = 'joined',
  Ready = 'ready',
  TimerStarted = 'timer_started',
  Heartbeat = 'heartbeat',
  TaskChanged = 'task_changed',
  MeaningfulAction = 'meaningful_action',
  StepAcked = 'step_acked',
  StepAdvanced = 'step_advanced',
  ChatMessage = 'chat_message',
  WsJoined = 'ws_joined',
  Left = 'left',
  Completed = 'completed',
  Expired = 'expired',
}

export const STUDY_ALLOWED_DURATIONS_MIN = [15, 25, 45, 60] as const;

export const STUDY_SHARED_BONUS_COINS = 15;
export const STUDY_SHARED_BONUS_GEMS = 2;
export const STUDY_WEEKLY_REWARD_CAP = 3;
export const STUDY_PAIR_DAILY_REWARD_CAP = 2;

/** Qualify if verified active >= this fraction of planned duration. */
export const STUDY_QUALIFY_ACTIVE_RATIO = 0.8;
/** Alternate meaningful-action floor: 5 verified study minutes. */
export const STUDY_MIN_VERIFIED_MINUTES = 5;

export const STUDY_HEARTBEAT_INTERVAL_SEC = 15;
export const STUDY_DISCONNECT_GRACE_SEC = 60;

export const STUDY_INVITE_EXPIRY_NOW_MS = 10 * 60 * 1000;
export const STUDY_INVITE_EXPIRY_WITHIN_MS = 60 * 60 * 1000;
export const STUDY_INVITE_EXPIRY_SCHEDULED_AFTER_START_MS = 30 * 60 * 1000;

export const STUDY_MESSAGE_MAX_LEN = 160;
export const STUDY_CHAT_MESSAGE_MAX_LEN = 500;
export const STUDY_MAX_CONCURRENT_ROOMS = 10;

/** Study chat media limits */
export const STUDY_CHAT_VOICE_MAX_MS = 60_000;
export const STUDY_CHAT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const STUDY_CHAT_AUDIO_MAX_BYTES = 2 * 1024 * 1024;
export const STUDY_CHAT_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
export const STUDY_CHAT_AUDIO_MIMES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
]);
