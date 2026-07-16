import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { BADGE_CORE_TOTAL, UserBadgeStatus } from '../badges/badge.constants';
import { UserBadge } from '../badges/entities/user-badge.entity';
import { BattleResult } from '../battles/entities/battle-result.entity';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { UserLeagueState } from '../leagues/entities/user-league-state.entity';
import { NotificationType } from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { Profile } from '../profiles/entities/profile.entity';
import {
  LessonProgress,
  LessonProgressStatus,
} from '../roadmaps/entities/lesson-progress.entity';
import { User } from '../users/entities/user.entity';
import { RankAvatarService } from '../ranks/rank-avatar.service';
import { Follow } from './entities/follow.entity';
import {
  FriendRequest,
  FriendRequestStatus,
} from './entities/friend-request.entity';
import {
  Friendship,
  friendshipPair,
} from './entities/friendship.entity';
import {
  SocialActivityEvent,
  SocialActivityEventType,
  SocialActivityVisibility,
} from './entities/social-activity-event.entity';
import { SocialCounter } from './entities/social-counter.entity';
import {
  InviteFromPolicy,
  MessagesFromPolicy,
  PresenceVisibility,
  ProfileVisibility,
  SocialPrivacySettings,
} from './entities/social-privacy-settings.entity';
import { UserBlock } from './entities/user-block.entity';
import {
  SocialReportContext,
  SocialReportReason,
  SocialReportStatus,
  UserReport,
} from './entities/user-report.entity';
import { SocialPermissionService } from './social-permission.service';
import { SocialPresenceService } from './social-presence.service';

const FRIEND_REQUEST_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const AVATAR_COLORS = [
  '#6B4EFF',
  '#2DB7F5',
  '#FF8A3D',
  '#16C784',
  '#E5484D',
  '#F0A81E',
];

@Injectable()
export class SocialService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly permissions: SocialPermissionService,
    private readonly presence: SocialPresenceService,
    private readonly notifications: NotificationsService,
    @InjectRepository(Friendship)
    private readonly friendshipsRepo: Repository<Friendship>,
    @InjectRepository(FriendRequest)
    private readonly requestsRepo: Repository<FriendRequest>,
    @InjectRepository(UserBlock)
    private readonly blocksRepo: Repository<UserBlock>,
    @InjectRepository(Follow)
    private readonly followsRepo: Repository<Follow>,
    @InjectRepository(SocialPrivacySettings)
    private readonly privacyRepo: Repository<SocialPrivacySettings>,
    @InjectRepository(SocialActivityEvent)
    private readonly activityRepo: Repository<SocialActivityEvent>,
    @InjectRepository(SocialCounter)
    private readonly countersRepo: Repository<SocialCounter>,
    @InjectRepository(UserReport)
    private readonly reportsRepo: Repository<UserReport>,
    @InjectRepository(Profile)
    private readonly profilesRepo: Repository<Profile>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(UserLeagueState)
    private readonly leagueStateRepo: Repository<UserLeagueState>,
    private readonly rankAvatars: RankAvatarService,
  ) {}

  async heartbeat(userId: string) {
    return this.presence.heartbeat(userId);
  }

  async listFriends(
    userId: string,
    opts?: { online?: boolean; cursor?: string },
  ) {
    const take = 40;
    const qb = this.friendshipsRepo
      .createQueryBuilder('f')
      .where('f.ended_at IS NULL')
      .andWhere('(f.user_low_id = :userId OR f.user_high_id = :userId)', {
        userId,
      })
      .orderBy('f.created_at', 'DESC')
      .take(take + 1);
    if (opts?.cursor) {
      qb.andWhere('f.created_at < :cursor', {
        cursor: new Date(opts.cursor),
      });
    }
    const rows = await qb.getMany();
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const friendIds = page.map((r) =>
      r.userLowId === userId ? r.userHighId : r.userLowId,
    );
    if (!friendIds.length) {
      return { items: [], nextCursor: null };
    }

    const items = await this.mapUserCards(friendIds);
    const onlineIds = await this.presence.areOnline(friendIds);
    for (const item of items) {
      item.online = onlineIds.has(item.userId) || item.online;
      item.canBattle = true;
    }
    let filtered = items;
    if (opts?.online) filtered = items.filter((f) => f.online);

    return {
      items: filtered,
      nextCursor: hasMore
        ? page[page.length - 1].createdAt.toISOString()
        : null,
    };
  }

  async searchUsers(viewerId: string, rawQ: string, cursor?: string) {
    const q = rawQ.trim();
    if (q.length < 2) {
      return { items: [], nextCursor: null, query: q };
    }

    const take = 20;
    const blockedIds = await this.blockedPairIds(viewerId);

    const qb = this.profilesRepo
      .createQueryBuilder('p')
      .innerJoin(User, 'u', 'u.id = p.user_id')
      .where('p.user_id != :viewerId', { viewerId })
      .andWhere('u.is_active = true')
      .andWhere('u.deleted_at IS NULL')
      .andWhere('(p.username ILIKE :q OR p.display_name ILIKE :q)', {
        q: `%${q}%`,
      })
      .orderBy('p.username', 'ASC', 'NULLS LAST')
      .addOrderBy('p.user_id', 'ASC')
      .take(take + 1);

    if (cursor) qb.andWhere('p.user_id > :cursor', { cursor });

    const profiles = await qb.getMany();
    const visible = profiles.filter((p) => !blockedIds.has(p.userId));
    const hasMore = visible.length > take;
    const page = visible.slice(0, take);
    if (!page.length) return { items: [], nextCursor: null, query: q };

    const ids = page.map((p) => p.userId);
    const cards = await this.mapUserCards(ids);
    const relations = await this.relationshipMap(viewerId, ids);
    const onlineIds = await this.presence.areOnline(ids);

    const items = cards.map((c) => {
      const rel = relations.get(c.userId) ?? {
        relationship: 'none' as const,
        pendingRequestId: null as string | null,
        isFollowing: false,
      };
      return {
        ...c,
        online: onlineIds.has(c.userId) || c.online,
        relationship: rel.relationship,
        pendingRequestId: rel.pendingRequestId,
        isFollowing: rel.isFollowing,
        canBattle: rel.relationship === 'friend',
        canAddFriend: rel.relationship === 'none',
      };
    });

    return {
      items,
      nextCursor: hasMore ? page[page.length - 1]?.userId ?? null : null,
      query: q,
    };
  }

  async sendFriendRequest(
    senderId: string,
    receiverId: string,
    message?: string,
  ) {
    if (senderId === receiverId) {
      throw new AppException(
        AuthErrorCode.SOCIAL_SELF_ACTION_NOT_ALLOWED,
        'Cannot friend yourself',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (await this.permissions.isBlockedEither(senderId, receiverId)) {
      throw new AppException(
        AuthErrorCode.SOCIAL_BLOCKED,
        'Cannot interact with this user',
        HttpStatus.FORBIDDEN,
      );
    }
    if (await this.permissions.areFriends(senderId, receiverId)) {
      throw new AppException(
        AuthErrorCode.ALREADY_FRIENDS,
        'Already friends',
        HttpStatus.CONFLICT,
      );
    }

    const privacy = await this.ensurePrivacy(receiverId);
    if (!privacy.allowFriendRequests) {
      throw new AppException(
        AuthErrorCode.SOCIAL_NOT_ALLOWED,
        'User is not accepting friend requests',
        HttpStatus.FORBIDDEN,
      );
    }

    const receiver = await this.usersRepo.findOneBy({ id: receiverId });
    if (!receiver?.isActive) {
      throw new AppException(
        AuthErrorCode.SOCIAL_USER_NOT_FOUND,
        'User not available',
        HttpStatus.NOT_FOUND,
      );
    }

    const existing = await this.requestsRepo.findOne({
      where: [
        { senderId, receiverId, status: FriendRequestStatus.Pending },
        {
          senderId: receiverId,
          receiverId: senderId,
          status: FriendRequestStatus.Pending,
        },
      ],
    });
    if (existing) {
      if (existing.expiresAt < new Date()) {
        existing.status = FriendRequestStatus.Expired;
        await this.requestsRepo.save(existing);
      } else if (existing.senderId === receiverId) {
        return this.acceptFriendRequest(senderId, existing.id);
      } else {
        return {
          request: this.toRequestDto(existing),
          relationship: {
            isFriend: false,
            isFollowing: await this.isFollowing(senderId, receiverId),
            requestDirection: 'outgoing' as const,
          },
        };
      }
    }

    const row = await this.requestsRepo.save(
      this.requestsRepo.create({
        senderId,
        receiverId,
        message: message?.slice(0, 160) ?? null,
        status: FriendRequestStatus.Pending,
        expiresAt: new Date(Date.now() + FRIEND_REQUEST_TTL_MS),
        respondedAt: null,
      }),
    );

    await this.notifications.create({
      userId: receiverId,
      type: NotificationType.FriendRequest,
      title: 'Friend request',
      body: 'Someone wants to join your crew.',
      actionUrl: '/friends',
      dedupeKey: `friend-request:${row.id}`,
      payload: { requestId: row.id, senderId },
    });

    return {
      request: this.toRequestDto(row),
      relationship: {
        isFriend: false,
        isFollowing: await this.isFollowing(senderId, receiverId),
        requestDirection: 'outgoing' as const,
      },
    };
  }

  async listIncomingRequests(userId: string) {
    await this.expireStaleForUser(userId);
    const rows = await this.requestsRepo.find({
      where: { receiverId: userId, status: FriendRequestStatus.Pending },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return { items: await this.enrichRequests(rows, 'from') };
  }

  async listOutgoingRequests(userId: string) {
    await this.expireStaleForUser(userId);
    const rows = await this.requestsRepo.find({
      where: { senderId: userId, status: FriendRequestStatus.Pending },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return { items: await this.enrichRequests(rows, 'to') };
  }

  async acceptFriendRequest(userId: string, requestId: string) {
    return this.dataSource.transaction(async (manager) => {
      const reqRepo = manager.getRepository(FriendRequest);
      const row = await reqRepo.findOne({
        where: { id: requestId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) {
        throw new AppException(
          AuthErrorCode.FRIEND_REQUEST_NOT_FOUND,
          'Request not found',
          HttpStatus.NOT_FOUND,
        );
      }
      if (row.receiverId !== userId) {
        throw new AppException(
          AuthErrorCode.FRIEND_REQUEST_NOT_RECEIVER,
          'Only receiver may accept',
          HttpStatus.FORBIDDEN,
        );
      }
      if (row.status !== FriendRequestStatus.Pending) {
        throw new AppException(
          AuthErrorCode.SOCIAL_NOT_ALLOWED,
          'Request not pending',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (row.expiresAt < new Date()) {
        row.status = FriendRequestStatus.Expired;
        await reqRepo.save(row);
        throw new AppException(
          AuthErrorCode.SOCIAL_NOT_ALLOWED,
          'Request expired',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (await this.permissions.isBlockedEither(row.senderId, row.receiverId)) {
        throw new AppException(
          AuthErrorCode.SOCIAL_BLOCKED,
          'Cannot interact with this user',
          HttpStatus.FORBIDDEN,
        );
      }

      row.status = FriendRequestStatus.Accepted;
      row.respondedAt = new Date();
      await reqRepo.save(row);

      const pair = friendshipPair(row.senderId, row.receiverId);
      const friendRepo = manager.getRepository(Friendship);
      let friendship = await friendRepo.findOne({
        where: { ...pair, endedAt: IsNull() },
      });
      if (!friendship) {
        const ended = await friendRepo.findOne({ where: pair });
        if (ended?.endedAt) {
          ended.endedAt = null;
          ended.createdFromRequestId = row.id;
          friendship = await friendRepo.save(ended);
        } else {
          friendship = await friendRepo.save(
            friendRepo.create({
              ...pair,
              createdFromRequestId: row.id,
              endedAt: null,
            }),
          );
        }
      }

      // Mutual follows by default
      await this.ensureFollowInTx(manager, row.senderId, row.receiverId);
      await this.ensureFollowInTx(manager, row.receiverId, row.senderId);

      await this.rebuildCountersInTx(manager, row.senderId);
      await this.rebuildCountersInTx(manager, row.receiverId);

      return {
        friendshipId: friendship.id,
        relationship: {
          isFriend: true,
          isFollowing: true,
          requestDirection: null,
        },
      };
    }).then(async (result) => {
      const row = await this.requestsRepo.findOne({ where: { id: requestId } });
      if (row) {
        await this.notifications.create({
          userId: row.senderId,
          type: NotificationType.FriendRequestAccepted,
          title: 'Friend request accepted',
          body: 'You’re now friends on Arc.',
          actionUrl: '/friends',
          dedupeKey: `friend-accepted:${requestId}`,
          payload: { requestId, friendUserId: row.receiverId },
        });
      }
      return result;
    });
  }

  async declineFriendRequest(userId: string, requestId: string) {
    const row = await this.requestsRepo.findOne({ where: { id: requestId } });
    if (!row) {
      throw new AppException(
        AuthErrorCode.FRIEND_REQUEST_NOT_FOUND,
        'Request not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (row.receiverId !== userId) {
      throw new AppException(
        AuthErrorCode.FRIEND_REQUEST_NOT_RECEIVER,
        'Only receiver may decline',
        HttpStatus.FORBIDDEN,
      );
    }
    row.status = FriendRequestStatus.Declined;
    row.respondedAt = new Date();
    await this.requestsRepo.save(row);
    return { ok: true };
  }

  async cancelFriendRequest(userId: string, requestId: string) {
    const row = await this.requestsRepo.findOne({ where: { id: requestId } });
    if (!row) {
      throw new AppException(
        AuthErrorCode.FRIEND_REQUEST_NOT_FOUND,
        'Request not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (row.senderId !== userId) {
      throw new AppException(
        AuthErrorCode.SOCIAL_NOT_ALLOWED,
        'Only sender may cancel',
        HttpStatus.FORBIDDEN,
      );
    }
    if (row.status !== FriendRequestStatus.Pending) {
      throw new AppException(
        AuthErrorCode.SOCIAL_NOT_ALLOWED,
        'Request not pending',
        HttpStatus.BAD_REQUEST,
      );
    }
    row.status = FriendRequestStatus.Cancelled;
    row.respondedAt = new Date();
    await this.requestsRepo.save(row);
    return { ok: true };
  }

  async removeFriend(
    userId: string,
    friendUserId: string,
    unfollow = false,
  ) {
    if (userId === friendUserId) {
      throw new AppException(
        AuthErrorCode.SOCIAL_SELF_ACTION_NOT_ALLOWED,
        'Cannot unfriend yourself',
        HttpStatus.BAD_REQUEST,
      );
    }
    const pair = friendshipPair(userId, friendUserId);
    const friendship = await this.friendshipsRepo.findOne({
      where: { ...pair, endedAt: IsNull() },
    });
    if (!friendship) {
      throw new AppException(
        AuthErrorCode.NOT_FRIENDS,
        'Not friends',
        HttpStatus.BAD_REQUEST,
      );
    }
    friendship.endedAt = new Date();
    await this.friendshipsRepo.save(friendship);

    if (unfollow) {
      await this.followsRepo.delete({
        followerId: userId,
        followedId: friendUserId,
      });
      await this.followsRepo.delete({
        followerId: friendUserId,
        followedId: userId,
      });
    }

    await this.rebuildCounters(userId);
    await this.rebuildCounters(friendUserId);
    return { ok: true };
  }

  async follow(followerId: string, followedId: string) {
    if (followerId === followedId) {
      throw new AppException(
        AuthErrorCode.SOCIAL_SELF_ACTION_NOT_ALLOWED,
        'Cannot follow yourself',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (await this.permissions.isBlockedEither(followerId, followedId)) {
      throw new AppException(
        AuthErrorCode.SOCIAL_BLOCKED,
        'Cannot interact with this user',
        HttpStatus.FORBIDDEN,
      );
    }
    const privacy = await this.ensurePrivacy(followedId);
    if (!privacy.allowFollows) {
      throw new AppException(
        AuthErrorCode.FOLLOW_NOT_ALLOWED,
        'User is not accepting follows',
        HttpStatus.FORBIDDEN,
      );
    }
    const target = await this.usersRepo.findOneBy({ id: followedId });
    if (!target?.isActive) {
      throw new AppException(
        AuthErrorCode.SOCIAL_USER_NOT_FOUND,
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const existing = await this.followsRepo.findOne({
      where: { followerId, followedId },
    });
    if (existing) {
      return { ok: true, alreadyFollowing: true };
    }

    await this.followsRepo.save(
      this.followsRepo.create({ followerId, followedId }),
    );
    await this.rebuildCounters(followerId);
    await this.rebuildCounters(followedId);

    await this.notifications.create({
      userId: followedId,
      type: NotificationType.NewFollower,
      title: 'New follower',
      body: 'Someone followed your Arc journey.',
      actionUrl: `/friends`,
      dedupeKey: `follow:${followerId}:${followedId}`,
      payload: { followerId },
    });

    return { ok: true, alreadyFollowing: false };
  }

  async unfollow(followerId: string, followedId: string) {
    await this.followsRepo.delete({ followerId, followedId });
    await this.rebuildCounters(followerId);
    await this.rebuildCounters(followedId);
    return { ok: true };
  }

  async listFollowers(userId: string, cursor?: string) {
    const take = 40;
    const qb = this.followsRepo
      .createQueryBuilder('f')
      .where('f.followed_id = :userId', { userId })
      .orderBy('f.created_at', 'DESC')
      .take(take + 1);
    if (cursor) {
      qb.andWhere('f.created_at < :cursor', { cursor: new Date(cursor) });
    }
    const rows = await qb.getMany();
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const ids = page.map((r) => r.followerId);
    const items = await this.mapUserCards(ids);
    return {
      items,
      nextCursor: hasMore
        ? page[page.length - 1].createdAt.toISOString()
        : null,
    };
  }

  async listFollowing(userId: string, cursor?: string) {
    const take = 40;
    const qb = this.followsRepo
      .createQueryBuilder('f')
      .where('f.follower_id = :userId', { userId })
      .orderBy('f.created_at', 'DESC')
      .take(take + 1);
    if (cursor) {
      qb.andWhere('f.created_at < :cursor', { cursor: new Date(cursor) });
    }
    const rows = await qb.getMany();
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const ids = page.map((r) => r.followedId);
    const items = await this.mapUserCards(ids);
    return {
      items,
      nextCursor: hasMore
        ? page[page.length - 1].createdAt.toISOString()
        : null,
    };
  }

  async blockUser(blockerId: string, blockedId: string, reasonCode?: string) {
    if (blockerId === blockedId) {
      throw new AppException(
        AuthErrorCode.SOCIAL_SELF_ACTION_NOT_ALLOWED,
        'Cannot block yourself',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.dataSource.transaction(async (manager) => {
      const blockRepo = manager.getRepository(UserBlock);
      let block = await blockRepo.findOne({
        where: { blockerId, blockedId },
      });
      if (!block) {
        block = await blockRepo.save(
          blockRepo.create({
            blockerId,
            blockedId,
            reasonCode: reasonCode ?? null,
          }),
        );
      }

      // Cancel pending requests both ways
      await manager.getRepository(FriendRequest).update(
        [
          {
            senderId: blockerId,
            receiverId: blockedId,
            status: FriendRequestStatus.Pending,
          },
          {
            senderId: blockedId,
            receiverId: blockerId,
            status: FriendRequestStatus.Pending,
          },
        ],
        {
          status: FriendRequestStatus.Cancelled,
          respondedAt: new Date(),
        },
      );

      // Soft-end friendship
      const pair = friendshipPair(blockerId, blockedId);
      const friendship = await manager.getRepository(Friendship).findOne({
        where: { ...pair, endedAt: IsNull() },
      });
      if (friendship) {
        friendship.endedAt = new Date();
        await manager.getRepository(Friendship).save(friendship);
      }

      // Delete follows both ways
      await manager.getRepository(Follow).delete({
        followerId: blockerId,
        followedId: blockedId,
      });
      await manager.getRepository(Follow).delete({
        followerId: blockedId,
        followedId: blockerId,
      });

      await this.rebuildCountersInTx(manager, blockerId);
      await this.rebuildCountersInTx(manager, blockedId);

      return { ok: true, blockId: block.id };
    });
  }

  async unblockUser(blockerId: string, blockedId: string) {
    await this.blocksRepo.delete({ blockerId, blockedId });
    return { ok: true };
  }

  async listBlocks(userId: string) {
    const rows = await this.blocksRepo.find({
      where: { blockerId: userId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    const ids = rows.map((r) => r.blockedId);
    const cards = await this.mapUserCards(ids);
    return {
      items: cards.map((c) => ({
        ...c,
        blockedAt:
          rows.find((r) => r.blockedId === c.userId)?.createdAt.toISOString() ??
          null,
      })),
    };
  }

  async createReport(input: {
    reporterId: string;
    reportedUserId: string;
    contextType: SocialReportContext;
    contextId?: string | null;
    reason: SocialReportReason;
    details?: string | null;
  }) {
    if (input.reporterId === input.reportedUserId) {
      throw new AppException(
        AuthErrorCode.SOCIAL_SELF_ACTION_NOT_ALLOWED,
        'Cannot report yourself',
        HttpStatus.BAD_REQUEST,
      );
    }
    const target = await this.usersRepo.findOneBy({
      id: input.reportedUserId,
    });
    if (!target) {
      throw new AppException(
        AuthErrorCode.SOCIAL_USER_NOT_FOUND,
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }
    const row = await this.reportsRepo.save(
      this.reportsRepo.create({
        reporterId: input.reporterId,
        reportedUserId: input.reportedUserId,
        contextType: input.contextType,
        contextId: input.contextId ?? null,
        reason: input.reason,
        details: input.details?.slice(0, 1000) ?? null,
        status: SocialReportStatus.Open,
      }),
    );
    return { id: row.id, status: row.status };
  }

  async getPrivacy(userId: string) {
    const row = await this.ensurePrivacy(userId);
    return this.toPrivacyDto(row);
  }

  async updatePrivacy(
    userId: string,
    patch: Partial<{
      profileVisibility: ProfileVisibility;
      showWeeklyXp: boolean;
      showStreak: boolean;
      showCurrentLesson: boolean;
      showBattleHistory: boolean;
      showStudyActivity: boolean;
      allowFriendRequests: boolean;
      allowFollows: boolean;
      allowBattleInvitesFrom: InviteFromPolicy;
      allowStudyInvitesFrom: InviteFromPolicy;
      allowMessagesFrom: MessagesFromPolicy;
      presenceVisibility: PresenceVisibility;
      leaderboardVisible: boolean;
      hideFromSuggestions: boolean;
    }>,
  ) {
    const row = await this.ensurePrivacy(userId);
    Object.assign(row, patch);
    await this.privacyRepo.save(row);
    return this.toPrivacyDto(row);
  }

  async getSocialProfile(viewerId: string, targetUserId: string) {
    if (await this.permissions.isBlockedEither(viewerId, targetUserId)) {
      throw new AppException(
        AuthErrorCode.SOCIAL_BLOCKED,
        'Cannot view this profile',
        HttpStatus.FORBIDDEN,
      );
    }
    const user = await this.usersRepo.findOneBy({ id: targetUserId });
    if (!user?.isActive) {
      throw new AppException(
        AuthErrorCode.SOCIAL_USER_NOT_FOUND,
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const privacy = await this.ensurePrivacy(targetUserId);
    const isSelf = viewerId === targetUserId;
    const isFriend = await this.permissions.areFriends(viewerId, targetUserId);
    const isFollower = await this.isFollowing(viewerId, targetUserId);
    const canView = this.canViewProfile(
      privacy.profileVisibility,
      isSelf,
      isFriend,
      isFollower,
    );
    if (!canView) {
      throw new AppException(
        AuthErrorCode.PROFILE_PRIVATE,
        'Profile is private',
        HttpStatus.FORBIDDEN,
      );
    }

    const [cards, counters, followingThem, theyFollow, stats] =
      await Promise.all([
        this.mapUserCards([targetUserId]),
        this.ensureCounters(targetUserId),
        this.isFollowing(viewerId, targetUserId),
        this.isFollowing(targetUserId, viewerId),
        this.profileActivityStats(targetUserId, privacy, isSelf),
      ]);
    const card = cards[0];
    const online = await this.presence.isOnline(targetUserId);

    return {
      userId: targetUserId,
      displayName: card?.displayName ?? null,
      username: card?.username ?? null,
      name: card?.name ?? 'Learner',
      initial: card?.initial ?? '?',
      color: card?.color ?? AVATAR_COLORS[0],
      avatarUrl: card?.avatarUrl ?? null,
      level: card?.level ?? 1,
      league: card?.league ?? 'Bronze',
      online: online || Boolean(card?.online),
      relationship: {
        isFriend,
        isFollowing: followingThem,
        isFollower: theyFollow,
        requestDirection: null as string | null,
      },
      counters: {
        friends: counters.friendsCount,
        followers: counters.followersCount,
        following: counters.followingCount,
      },
      stats,
      privacy: {
        showWeeklyXp: privacy.showWeeklyXp,
        showStreak: privacy.showStreak,
        showBattleHistory: privacy.showBattleHistory,
        showStudyActivity: privacy.showStudyActivity,
      },
      /** One-way follow allowed when target privacy permits and not already following. */
      canFollow: !isSelf && privacy.allowFollows && !followingThem,
      canUnfollow: !isSelf && followingThem,
      canBattle: isFriend,
      canStudy: isFriend,
      relationshipVersion: `${isFriend}:${followingThem}:${theyFollow}`,
    };
  }

  /** Passport activity chips — respect privacy flags for non-self viewers. */
  private async profileActivityStats(
    userId: string,
    privacy: SocialPrivacySettings,
    isSelf: boolean,
  ): Promise<{
    lessonsThisWeek: number;
    battlesWon: number;
    badgesEarned: number;
    badgesTotal: number;
  }> {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const showStudy = isSelf || privacy.showStudyActivity;
    const showBattles = isSelf || privacy.showBattleHistory;

    const progressRepo = this.dataSource.getRepository(LessonProgress);
    const resultsRepo = this.dataSource.getRepository(BattleResult);
    const badgesRepo = this.dataSource.getRepository(UserBadge);

    const [lessonsThisWeek, battlesWon, badgesEarned] = await Promise.all([
      showStudy
        ? progressRepo.count({
            where: {
              userId,
              status: LessonProgressStatus.Completed,
              completedAt: MoreThanOrEqual(weekAgo),
            },
          })
        : Promise.resolve(0),
      showBattles
        ? resultsRepo.count({
            where: {
              userId,
              result: 'win',
              createdAt: MoreThanOrEqual(weekAgo),
            },
          })
        : Promise.resolve(0),
      badgesRepo.count({
        where: { userId, status: UserBadgeStatus.Earned },
      }),
    ]);

    return {
      lessonsThisWeek,
      battlesWon,
      badgesEarned,
      badgesTotal: BADGE_CORE_TOTAL,
    };
  }

  async listMutuals(viewerId: string, targetUserId: string) {
    if (await this.permissions.isBlockedEither(viewerId, targetUserId)) {
      throw new AppException(
        AuthErrorCode.SOCIAL_BLOCKED,
        'Cannot view mutuals',
        HttpStatus.FORBIDDEN,
      );
    }
    const viewerFriends = await this.friendIds(viewerId);
    const targetFriends = await this.friendIds(targetUserId);
    const mutual = [...viewerFriends].filter((id) => targetFriends.has(id));
    const items = await this.mapUserCards(mutual.slice(0, 40));
    return { items, count: mutual.length };
  }

  async getSuggestions(userId: string, cursor?: string) {
    const take = 20;
    const exclude = new Set<string>([userId]);
    for (const id of await this.blockedPairIds(userId)) exclude.add(id);
    for (const id of await this.friendIds(userId)) exclude.add(id);

    const pending = await this.requestsRepo.find({
      where: [
        { senderId: userId, status: FriendRequestStatus.Pending },
        { receiverId: userId, status: FriendRequestStatus.Pending },
      ],
    });
    for (const r of pending) {
      exclude.add(r.senderId === userId ? r.receiverId : r.senderId);
    }

    // Mutual friends first
    const myFriends = [...(await this.friendIds(userId))];
    const scores = new Map<string, number>();
    for (const fid of myFriends.slice(0, 50)) {
      const theirFriends = await this.friendIds(fid);
      for (const mid of theirFriends) {
        if (exclude.has(mid)) continue;
        scores.set(mid, (scores.get(mid) ?? 0) + 5);
      }
    }

    // Same league cohort boost
    const myLeague = await this.leagueStateRepo.findOne({
      where: { userId },
    });
    if (myLeague?.tier) {
      const peers = await this.leagueStateRepo.find({
        where: { tier: myLeague.tier },
        take: 40,
      });
      for (const p of peers) {
        if (exclude.has(p.userId)) continue;
        scores.set(p.userId, (scores.get(p.userId) ?? 0) + 2);
      }
    }

    const ranked = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);

    let start = 0;
    if (cursor) {
      const idx = ranked.indexOf(cursor);
      start = idx >= 0 ? idx + 1 : 0;
    }
    const slice = ranked.slice(start, start + take + 1);

    // Filter hideFromSuggestions
    const privacyRows = slice.length
      ? await this.privacyRepo.find({ where: { userId: In(slice) } })
      : [];
    const hidden = new Set(
      privacyRows.filter((p) => p.hideFromSuggestions).map((p) => p.userId),
    );
    const visible = slice.filter((id) => !hidden.has(id));
    const hasMore = visible.length > take;
    const page = visible.slice(0, take);
    const items = await this.mapUserCards(page);

    return {
      items,
      nextCursor: hasMore ? page[page.length - 1] ?? null : null,
    };
  }

  async listActivity(
    viewerId: string,
    scope: 'friends' | 'following' | 'me' = 'friends',
    cursor?: string,
  ) {
    const take = 30;
    let actorIds: string[] = [viewerId];
    if (scope === 'friends') {
      actorIds = [viewerId, ...(await this.friendIds(viewerId))];
    } else if (scope === 'following') {
      const following = await this.followsRepo.find({
        where: { followerId: viewerId },
        take: 200,
      });
      actorIds = [viewerId, ...following.map((f) => f.followedId)];
    }

    const qb = this.activityRepo
      .createQueryBuilder('a')
      .where('a.actor_id IN (:...actorIds)', { actorIds })
      .orderBy('a.created_at', 'DESC')
      .take(take + 1);
    if (cursor) {
      qb.andWhere('a.created_at < :cursor', { cursor: new Date(cursor) });
    }
    const rows = await qb.getMany();
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;

    const friendSet = await this.friendIds(viewerId);
    const followingSet = new Set(
      (
        await this.followsRepo.find({
          where: { followerId: viewerId },
          take: 500,
        })
      ).map((f) => f.followedId),
    );

    const filtered = page.filter((ev) => {
      if (ev.actorId === viewerId) return true;
      if (ev.visibility === SocialActivityVisibility.Public) return true;
      if (ev.visibility === SocialActivityVisibility.Friends) {
        return friendSet.has(ev.actorId);
      }
      if (ev.visibility === SocialActivityVisibility.Followers) {
        return followingSet.has(ev.actorId) || friendSet.has(ev.actorId);
      }
      return false;
    });

    const actorCards = await this.mapUserCards([
      ...new Set(filtered.map((e) => e.actorId)),
    ]);
    const byActor = new Map(actorCards.map((c) => [c.userId, c]));

    return {
      items: filtered.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        actor: byActor.get(e.actorId) ?? { userId: e.actorId, name: 'Learner' },
        payload: e.payload,
        createdAt: e.createdAt.toISOString(),
      })),
      nextCursor: hasMore
        ? page[page.length - 1].createdAt.toISOString()
        : null,
    };
  }

  async publishActivity(input: {
    actorId: string;
    eventType: SocialActivityEventType;
    entityType?: string | null;
    entityId?: string | null;
    visibility?: SocialActivityVisibility;
    payload?: Record<string, unknown>;
  }) {
    const row = await this.activityRepo.save(
      this.activityRepo.create({
        actorId: input.actorId,
        eventType: input.eventType,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        visibility: input.visibility ?? SocialActivityVisibility.Friends,
        payload: input.payload ?? {},
      }),
    );
    return { id: row.id };
  }

  async ensurePrivacy(userId: string) {
    let row = await this.privacyRepo.findOne({ where: { userId } });
    if (!row) {
      row = await this.privacyRepo.save(
        this.privacyRepo.create({ userId }),
      );
    }
    return row;
  }

  // --- helpers ---

  private canViewProfile(
    visibility: ProfileVisibility,
    isSelf: boolean,
    isFriend: boolean,
    isFollower: boolean,
  ) {
    if (isSelf) return true;
    switch (visibility) {
      case ProfileVisibility.Public:
        return true;
      case ProfileVisibility.Followers:
        return isFollower || isFriend;
      case ProfileVisibility.Friends:
        return isFriend;
      case ProfileVisibility.Private:
        return false;
      default:
        return true;
    }
  }

  private async isFollowing(followerId: string, followedId: string) {
    const row = await this.followsRepo.findOne({
      where: { followerId, followedId },
    });
    return Boolean(row);
  }

  private async friendIds(userId: string) {
    const rows = await this.friendshipsRepo.find({
      where: [
        { userLowId: userId, endedAt: IsNull() },
        { userHighId: userId, endedAt: IsNull() },
      ],
    });
    return new Set(
      rows.map((r) => (r.userLowId === userId ? r.userHighId : r.userLowId)),
    );
  }

  private async blockedPairIds(userId: string) {
    const blocked = await this.blocksRepo.find({
      where: [{ blockerId: userId }, { blockedId: userId }],
    });
    const ids = new Set<string>();
    for (const b of blocked) {
      ids.add(b.blockerId === userId ? b.blockedId : b.blockerId);
    }
    return ids;
  }

  private async relationshipMap(viewerId: string, ids: string[]) {
    const [friendships, pending, follows] = await Promise.all([
      this.friendshipsRepo.find({
        where: [
          { userLowId: viewerId, userHighId: In(ids), endedAt: IsNull() },
          { userHighId: viewerId, userLowId: In(ids), endedAt: IsNull() },
        ],
      }),
      this.requestsRepo.find({
        where: [
          {
            senderId: viewerId,
            receiverId: In(ids),
            status: FriendRequestStatus.Pending,
          },
          {
            senderId: In(ids),
            receiverId: viewerId,
            status: FriendRequestStatus.Pending,
          },
        ],
      }),
      this.followsRepo.find({
        where: { followerId: viewerId, followedId: In(ids) },
      }),
    ]);

    const friendIds = new Set(
      friendships.map((f) =>
        f.userLowId === viewerId ? f.userHighId : f.userLowId,
      ),
    );
    const outgoing = new Set(
      pending.filter((r) => r.senderId === viewerId).map((r) => r.receiverId),
    );
    const incoming = new Map(
      pending
        .filter((r) => r.receiverId === viewerId)
        .map((r) => [r.senderId, r.id] as const),
    );
    const following = new Set(follows.map((f) => f.followedId));

    const map = new Map<
      string,
      {
        relationship: 'friend' | 'outgoing' | 'incoming' | 'none';
        pendingRequestId: string | null;
        isFollowing: boolean;
      }
    >();
    for (const id of ids) {
      let relationship: 'friend' | 'outgoing' | 'incoming' | 'none' = 'none';
      let pendingRequestId: string | null = null;
      if (friendIds.has(id)) relationship = 'friend';
      else if (outgoing.has(id)) relationship = 'outgoing';
      else if (incoming.has(id)) {
        relationship = 'incoming';
        pendingRequestId = incoming.get(id) ?? null;
      }
      map.set(id, {
        relationship,
        pendingRequestId,
        isFollowing: following.has(id),
      });
    }
    return map;
  }

  private async mapUserCards(userIds: string[]) {
    if (!userIds.length) return [];
    const [profiles, users, leagues, rankIcons] = await Promise.all([
      this.profilesRepo.find({ where: { userId: In(userIds) } }),
      this.usersRepo.find({ where: { id: In(userIds) } }),
      this.leagueStateRepo.find({ where: { userId: In(userIds) } }),
      this.rankAvatars.iconKeysByUserIds(userIds),
    ]);
    const profileBy = new Map(profiles.map((p) => [p.userId, p]));
    const userBy = new Map(users.map((u) => [u.id, u]));
    const leagueBy = new Map(leagues.map((l) => [l.userId, l]));

    return userIds.map((id, i) => {
      const profile = profileBy.get(id);
      const user = userBy.get(id);
      const league = leagueBy.get(id);
      const name = profile?.displayName || profile?.username || 'Learner';
      const initial = name.trim().charAt(0).toUpperCase() || '?';
      return {
        userId: id,
        displayName: profile?.displayName ?? null,
        username: profile?.username ?? null,
        name,
        initial,
        color: AVATAR_COLORS[i % AVATAR_COLORS.length],
        avatarUrl: rankIcons.get(id) ?? profile?.avatarUrl ?? null,
        level: league?.rankLevel ?? 1,
        league: league?.tier
          ? String(league.tier).charAt(0).toUpperCase() +
            String(league.tier).slice(1)
          : 'Bronze',
        online: Boolean(
          user?.lastLoginAt &&
            Date.now() - user.lastLoginAt.getTime() < 15 * 60 * 1000,
        ),
        canBattle: false,
      };
    });
  }

  private async enrichRequests(
    rows: FriendRequest[],
    side: 'from' | 'to',
  ) {
    const ids = rows.map((r) =>
      side === 'from' ? r.senderId : r.receiverId,
    );
    const profiles = ids.length
      ? await this.profilesRepo.find({ where: { userId: In(ids) } })
      : [];
    const byId = new Map(profiles.map((p) => [p.userId, p]));
    return rows.map((r) => {
      const uid = side === 'from' ? r.senderId : r.receiverId;
      const p = byId.get(uid);
      return {
        ...this.toRequestDto(r),
        [side]: {
          userId: uid,
          displayName: p?.displayName ?? null,
          username: p?.username ?? null,
        },
      };
    });
  }

  private async expireStaleForUser(userId: string) {
    await this.requestsRepo
      .createQueryBuilder()
      .update(FriendRequest)
      .set({ status: FriendRequestStatus.Expired })
      .where('status = :pending', { pending: FriendRequestStatus.Pending })
      .andWhere('expires_at < NOW()')
      .andWhere('(sender_id = :userId OR receiver_id = :userId)', { userId })
      .execute();
  }

  private async ensureFollowInTx(
    manager: DataSource['manager'],
    followerId: string,
    followedId: string,
  ) {
    const privacy = await manager.getRepository(SocialPrivacySettings).findOne({
      where: { userId: followedId },
    });
    if (privacy && !privacy.allowFollows) return;
    const followRepo = manager.getRepository(Follow);
    const existing = await followRepo.findOne({
      where: { followerId, followedId },
    });
    if (!existing) {
      await followRepo.save(followRepo.create({ followerId, followedId }));
    }
  }

  private async ensureCounters(userId: string) {
    let row = await this.countersRepo.findOne({ where: { userId } });
    if (!row) {
      row = await this.countersRepo.save(
        this.countersRepo.create({ userId }),
      );
    }
    return row;
  }

  private async rebuildCounters(userId: string) {
    await this.dataSource.transaction((manager) =>
      this.rebuildCountersInTx(manager, userId),
    );
  }

  private async rebuildCountersInTx(
    manager: DataSource['manager'],
    userId: string,
  ) {
    const counterRepo = manager.getRepository(SocialCounter);
    let row = await counterRepo.findOne({ where: { userId } });
    if (!row) {
      row = counterRepo.create({ userId });
    }
    row.friendsCount = await manager.getRepository(Friendship).count({
      where: [
        { userLowId: userId, endedAt: IsNull() },
        { userHighId: userId, endedAt: IsNull() },
      ],
    });
    row.followersCount = await manager.getRepository(Follow).count({
      where: { followedId: userId },
    });
    row.followingCount = await manager.getRepository(Follow).count({
      where: { followerId: userId },
    });
    await counterRepo.save(row);
  }

  private toRequestDto(row: FriendRequest) {
    return {
      id: row.id,
      senderId: row.senderId,
      receiverId: row.receiverId,
      status: row.status,
      message: row.message,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toPrivacyDto(row: SocialPrivacySettings) {
    return {
      profileVisibility: row.profileVisibility,
      showWeeklyXp: row.showWeeklyXp,
      showStreak: row.showStreak,
      showCurrentLesson: row.showCurrentLesson,
      showBattleHistory: row.showBattleHistory,
      showStudyActivity: row.showStudyActivity,
      allowFriendRequests: row.allowFriendRequests,
      allowFollows: row.allowFollows,
      allowBattleInvitesFrom: row.allowBattleInvitesFrom,
      allowStudyInvitesFrom: row.allowStudyInvitesFrom,
      allowMessagesFrom: row.allowMessagesFrom,
      presenceVisibility: row.presenceVisibility,
      leaderboardVisible: row.leaderboardVisible,
      hideFromSuggestions: row.hideFromSuggestions,
    };
  }
}
