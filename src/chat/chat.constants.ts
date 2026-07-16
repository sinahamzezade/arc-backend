export enum ConversationType {
  Direct = 'direct',
  Group = 'group',
}

export enum ConversationMemberRole {
  Member = 'member',
  Admin = 'admin',
}

export enum ChatMessageType {
  Text = 'text',
  Image = 'image',
  File = 'file',
  Audio = 'audio',
  System = 'system',
}

export enum ChatAttachmentScanStatus {
  Pending = 'pending',
  Clean = 'clean',
  Blocked = 'blocked',
}

export enum ChatReportReason {
  Spam = 'spam',
  Harassment = 'harassment',
  Inappropriate = 'inappropriate',
  Safety = 'safety',
  Other = 'other',
}

export enum ChatReportStatus {
  Open = 'open',
  Reviewing = 'reviewing',
  Actioned = 'actioned',
  Dismissed = 'dismissed',
}

export const CHAT_MAX_BODY_CHARS = 4000;
/** Ciphertext envelopes are larger than plaintext (base64url + nonce/tag). */
export const CHAT_MAX_E2E_BODY_CHARS = 12_000;
export const CHAT_E2E_BODY_PREFIX = 'e2e:v1:';
export const CHAT_MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export function isE2eBody(body: string | null | undefined): boolean {
  return typeof body === 'string' && body.startsWith(CHAT_E2E_BODY_PREFIX);
}
export const CHAT_VOICE_MAX_DURATION_MS = 60_000;
export const CHAT_VOICE_MIN_DURATION_MS = 400;
export const CHAT_MSG_RATE_LIMIT = 30; // per minute
export const CHAT_MSG_RATE_WINDOW_SEC = 60;
export const CHAT_CREATE_RATE_LIMIT = 10; // per hour
export const CHAT_CREATE_RATE_WINDOW_SEC = 3600;
export const CHAT_TYPING_TTL_SEC = 5;
export const CHAT_PRESENCE_TTL_SEC = 90;

export const CHAT_ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
]);

/** Strip codec params — browsers often send `audio/webm;codecs=opus`. */
export function normalizeMime(raw: string): string {
  return (raw || 'application/octet-stream').split(';')[0].trim().toLowerCase();
}

export function isChatAudioMime(mime: string): boolean {
  return normalizeMime(mime).startsWith('audio/');
}
export const ChatEventType = {
  MessageSent: 'chat.message_sent.v1',
  ConversationCreated: 'chat.conversation_created.v1',
  UserBlocked: 'chat.user_blocked.v1',
  ReportFiled: 'chat.report_filed.v1',
  AttachmentBlocked: 'chat.attachment_blocked.v1',
} as const;

/** Sorted pair key for unique direct conversations. */
export function directPairKey(a: string, b: string): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}
