import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { BattleStatus } from '../battles/battle.constants';
import { StudySessionStatus } from '../study-together/study.constants';
import { User } from '../users/entities/user.entity';
import { Follow } from './entities/follow.entity';
import {
  Friendship,
  friendshipPair,
} from './entities/friendship.entity';
import {
  InviteFromPolicy,
  MessagesFromPolicy,
  PresenceVisibility,
  SocialPrivacySettings,
} from './entities/social-privacy-settings.entity';
import { UserBlock } from './entities/user-block.entity';

@Injectable()
export class SocialPermissionService {
  constructor(
    @InjectRepository(Friendship)
    private readonly friendshipsRepo: Repository<Friendship>,
    @InjectRepository(UserBlock)
    private readonly blocksRepo: Repository<UserBlock>,
    @InjectRepository(Follow)
    private readonly followsRepo: Repository<Follow>,
    @InjectRepository(SocialPrivacySettings)
    private readonly privacyRepo: Repository<SocialPrivacySettings>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  async isBlockedEither(a: string, b: string): Promise<boolean> {
    const count = await this.blocksRepo.count({
      where: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    });
    return count > 0;
  }

  /** True when `blockerId` has blocked `blockedId` (one direction). */
  async isBlockedBy(blockerId: string, blockedId: string): Promise<boolean> {
    const count = await this.blocksRepo.count({
      where: { blockerId, blockedId },
    });
    return count > 0;
  }

  async areFriends(a: string, b: string): Promise<boolean> {
    const pair = friendshipPair(a, b);
    const row = await this.friendshipsRepo.findOne({
      where: { ...pair, endedAt: IsNull() },
    });
    return Boolean(row);
  }

  async isFollowing(followerId: string, followedId: string): Promise<boolean> {
    const row = await this.followsRepo.findOne({
      where: { followerId, followedId },
    });
    return Boolean(row);
  }

  private async inviteAllowed(
    challengerId: string,
    opponentId: string,
    policy: InviteFromPolicy,
  ): Promise<boolean> {
    if (policy === InviteFromPolicy.Nobody) return false;
    if (policy === InviteFromPolicy.Friends) {
      return this.areFriends(challengerId, opponentId);
    }
    if (policy === InviteFromPolicy.Followers) {
      return (
        (await this.areFriends(challengerId, opponentId)) ||
        (await this.isFollowing(challengerId, opponentId))
      );
    }
    return false;
  }

  /** Callee privacy: allow video/voice calls (defaults on if no row). */
  async canReceiveCall(
    calleeId: string,
    mode: 'audio' | 'video',
  ): Promise<boolean> {
    const privacy = await this.privacyRepo.findOne({
      where: { userId: calleeId },
    });
    if (!privacy) return true;
    return mode === 'video'
      ? privacy.allowVideoCalls !== false
      : privacy.allowVoiceCalls !== false;
  }

  /** Battle invites: privacy policy + not blocked. */
  async canBattleInvite(
    challengerId: string,
    opponentId: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (challengerId === opponentId) {
      return { allowed: false, reason: 'self' };
    }
    if (await this.isBlockedEither(challengerId, opponentId)) {
      return { allowed: false, reason: 'blocked' };
    }
    const privacy = await this.privacyRepo.findOne({
      where: { userId: opponentId },
    });
    const policy =
      privacy?.allowBattleInvitesFrom ?? InviteFromPolicy.Friends;
    if (!(await this.inviteAllowed(challengerId, opponentId, policy))) {
      return { allowed: false, reason: 'not_allowed' };
    }
    return { allowed: true };
  }

  /** Study Together invites: privacy policy + not blocked. */
  async canStudyInvite(
    inviterId: string,
    inviteeId: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (inviterId === inviteeId) {
      return { allowed: false, reason: 'self' };
    }
    if (await this.isBlockedEither(inviterId, inviteeId)) {
      return { allowed: false, reason: 'blocked' };
    }
    const privacy = await this.privacyRepo.findOne({
      where: { userId: inviteeId },
    });
    const policy =
      privacy?.allowStudyInvitesFrom ?? InviteFromPolicy.Friends;
    if (!(await this.inviteAllowed(inviterId, inviteeId, policy))) {
      return { allowed: false, reason: 'not_allowed' };
    }
    return { allowed: true };
  }

  /**
   * Direct-message gate: not blocked, respect allow_messages_from / minor,
   * friends OR shared active study/battle context.
   */
  async canMessage(
    senderId: string,
    recipientId: string,
  ): Promise<{ allowed: boolean; reason?: 'self' | 'blocked' | 'not_allowed' }> {
    if (senderId === recipientId) {
      return { allowed: false, reason: 'self' };
    }
    if (await this.isBlockedEither(senderId, recipientId)) {
      return { allowed: false, reason: 'blocked' };
    }

    const [sender, recipient] = await Promise.all([
      this.usersRepo.findOne({ where: { id: senderId } }),
      this.usersRepo.findOne({ where: { id: recipientId } }),
    ]);
    if (!sender || !recipient) {
      return { allowed: false, reason: 'not_allowed' };
    }

    const privacy = await this.privacyRepo.findOne({
      where: { userId: recipientId },
    });
    const policy =
      privacy?.allowMessagesFrom ?? MessagesFromPolicy.Friends;

    if (
      recipient.isMinor ||
      sender.isMinor ||
      policy === MessagesFromPolicy.Nobody
    ) {
      if (!(await this.areFriends(senderId, recipientId))) {
        return { allowed: false, reason: 'not_allowed' };
      }
      return { allowed: true };
    }

    if (await this.areFriends(senderId, recipientId)) {
      return { allowed: true };
    }

    if (await this.shareActiveContext(senderId, recipientId)) {
      return { allowed: true };
    }

    return { allowed: false, reason: 'not_allowed' };
  }

  /** Whether viewer may see target's presence/lastSeen. */
  async canSeePresence(
    viewerId: string,
    targetId: string,
  ): Promise<boolean> {
    if (viewerId === targetId) return true;
    if (await this.isBlockedEither(viewerId, targetId)) return false;

    const target = await this.usersRepo.findOne({ where: { id: targetId } });
    const privacy = await this.privacyRepo.findOne({
      where: { userId: targetId },
    });
    const visibility =
      target?.isMinor
        ? PresenceVisibility.Nobody
        : (privacy?.presenceVisibility ?? PresenceVisibility.Contacts);

    if (visibility === PresenceVisibility.Nobody) return false;
    if (visibility === PresenceVisibility.Everyone) return true;
    return this.areFriends(viewerId, targetId);
  }

  private async shareActiveContext(a: string, b: string): Promise<boolean> {
    const studyStatuses = [
      StudySessionStatus.Accepted,
      StudySessionStatus.Waiting,
      StudySessionStatus.Active,
    ];
    const battleStatuses = [
      BattleStatus.Accepted,
      BattleStatus.Funding,
      BattleStatus.Ready,
      BattleStatus.InProgress,
      BattleStatus.SuddenDeath,
    ];

    const studyRows = await this.dataSource.query(
      `
      SELECT 1 FROM study_sessions
      WHERE status = ANY($1)
        AND (
          (creator_id = $2 AND invitee_id = $3)
          OR (creator_id = $3 AND invitee_id = $2)
        )
      LIMIT 1
      `,
      [studyStatuses, a, b],
    );
    if (Array.isArray(studyRows) && studyRows.length > 0) return true;

    const battleRows = await this.dataSource.query(
      `
      SELECT 1 FROM battles
      WHERE status = ANY($1)
        AND (
          (challenger_id = $2 AND opponent_id = $3)
          OR (challenger_id = $3 AND opponent_id = $2)
        )
      LIMIT 1
      `,
      [battleStatuses, a, b],
    );
    return Array.isArray(battleRows) && battleRows.length > 0;
  }
}
