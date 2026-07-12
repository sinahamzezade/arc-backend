import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Follow } from './entities/follow.entity';
import {
  Friendship,
  friendshipPair,
} from './entities/friendship.entity';
import {
  InviteFromPolicy,
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
}
