import type { Request } from 'express';
import type { Session, SessionData } from 'express-session';

export type AdminSessionData = SessionData & {
  adminUserId?: string;
  adminEmail?: string;
};

export type AdminRequest = Request & {
  session: Session & AdminSessionData;
};
