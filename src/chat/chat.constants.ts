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
export const CHAT_MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
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
]);

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
