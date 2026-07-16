import { Injectable } from '@nestjs/common';
import { ChatService } from '../chat/chat.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SocialPresenceService } from '../social/social-presence.service';
import { SocialService } from '../social/social.service';

export type MePulseDto = {
  notificationsUnread: number;
  chatUnreadTotal: number;
  conversationsWithUnread: number;
  friendRequestsIncoming: number;
  presence: { online: boolean; ttlSec: number };
};

/**
 * Single badge + presence snapshot for the app background poll.
 */
@Injectable()
export class MePulseService {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly chat: ChatService,
    private readonly social: SocialService,
    private readonly presence: SocialPresenceService,
  ) {}

  async pulse(userId: string): Promise<MePulseDto> {
    const [
      notificationsUnread,
      chatSummary,
      friendRequestsIncoming,
      presence,
    ] = await Promise.all([
      this.notifications.countUnread(userId),
      this.chat.getSummary(userId),
      this.social.countIncomingRequests(userId),
      this.presence.heartbeat(userId),
    ]);

    return {
      notificationsUnread,
      chatUnreadTotal: chatSummary.unreadTotal,
      conversationsWithUnread: chatSummary.conversationsWithUnread,
      friendRequestsIncoming,
      presence,
    };
  }
}
