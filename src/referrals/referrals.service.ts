import { createHash, randomBytes } from 'crypto';
import {
  HttpStatus,
  Injectable,
  Logger,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { GamificationService } from '../gamification/gamification.service';
import {
  RewardCurrency,
  RewardReasonType,
} from '../gamification/entities/reward-ledger-entry.entity';
import { UserInventoryItem } from '../gamification/entities/user-inventory-item.entity';
import { UserBadge } from '../badges/entities/user-badge.entity';
import { NotificationType } from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import {
  Profile,
  QuestionnaireStatus,
} from '../profiles/entities/profile.entity';
import { ProfilesService } from '../profiles/profiles.service';
import {
  LessonProgress,
  LessonProgressStatus,
} from '../roadmaps/entities/lesson-progress.entity';
import {
  Roadmap,
  RoadmapStatus,
} from '../roadmaps/entities/roadmap.entity';
import { User } from '../users/entities/user.entity';
import {
  REFERRAL_CODE_ROTATE_COOLDOWN_DAYS,
  REFERRAL_COOKIE_TTL_DAYS,
  REFERRAL_FRIEND_COINS,
  REFERRAL_FRIEND_XP,
  REFERRAL_INVITER_COINS,
  REFERRAL_MANUAL_CLAIM_HOURS,
  REFERRAL_MILESTONES,
  REFERRAL_MIN_STUDY_MINUTES,
  REFERRAL_QUALIFY_WINDOW_DAYS,
  ReferralAttributionStatus,
  ReferralCodeStatus,
  ReferralLinkStatus,
  ReferralRewardGrantStatus,
  ReferralShareChannel,
  publicAppBase,
} from './referral.constants';
import {
  CreateReferralLinkDto,
  ReferralShareEventDto,
} from './dto/referrals.dto';
import { ReferralAttribution } from './entities/referral-attribution.entity';
import { ReferralClick } from './entities/referral-click.entity';
import { ReferralCode } from './entities/referral-code.entity';
import { ReferralLink } from './entities/referral-link.entity';
import { ReferralMilestone } from './entities/referral-milestone.entity';
import { ReferralRewardGrant } from './entities/referral-reward-grant.entity';
import {
  ReferralRiskReview,
  ReferralRiskStatus,
} from './entities/referral-risk-review.entity';
import { ReferralShareEvent } from './entities/referral-share-event.entity';

@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly profiles: ProfilesService,
    private readonly notifications: NotificationsService,
    @InjectRepository(ReferralCode)
    private readonly codesRepo: Repository<ReferralCode>,
    @InjectRepository(ReferralLink)
    private readonly linksRepo: Repository<ReferralLink>,
    @InjectRepository(ReferralClick)
    private readonly clicksRepo: Repository<ReferralClick>,
    @InjectRepository(ReferralAttribution)
    private readonly attributionsRepo: Repository<ReferralAttribution>,
    @InjectRepository(ReferralRewardGrant)
    private readonly grantsRepo: Repository<ReferralRewardGrant>,
    @InjectRepository(ReferralMilestone)
    private readonly milestonesRepo: Repository<ReferralMilestone>,
    @InjectRepository(ReferralShareEvent)
    private readonly shareEventsRepo: Repository<ReferralShareEvent>,
    @InjectRepository(ReferralRiskReview)
    private readonly riskRepo: Repository<ReferralRiskReview>,
    @InjectRepository(Profile)
    private readonly profilesRepo: Repository<Profile>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @Optional()
    @Inject(forwardRef(() => GamificationService))
    private readonly gamification?: GamificationService,
  ) {}

  private appBase() {
    return publicAppBase(
      this.config.get<string>('PUBLIC_APP_URL') ||
        this.config.get<string>('CORS_ORIGIN')?.split(',')[0],
    );
  }

  private linkUrl(token: string) {
    return `${this.appBase()}/r/${token}`;
  }

  private rewardPreview() {
    return {
      inviterCoins: REFERRAL_INVITER_COINS,
      friendCoins: REFERRAL_FRIEND_COINS,
      friendXp: REFERRAL_FRIEND_XP,
      perQualifiedFriend: { coins: REFERRAL_INVITER_COINS },
      friendGets: {
        coins: REFERRAL_FRIEND_COINS,
        lifetimeXp: REFERRAL_FRIEND_XP,
      },
    };
  }

  private makeToken() {
    return randomBytes(12).toString('base64url');
  }

  private makeCode(seed: string) {
    const clean = seed
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .slice(0, 8);
    const suffix = randomBytes(2).toString('hex').toUpperCase();
    return `${clean || 'ARC'}-${suffix}`;
  }

  async ensureCodeAndDefaultLink(userId: string) {
    let code = await this.codesRepo.findOne({
      where: { ownerUserId: userId, status: ReferralCodeStatus.Active },
    });
    if (!code) {
      const profile = await this.profilesRepo.findOne({ where: { userId } });
      const seed =
        profile?.username || profile?.displayName || userId.slice(0, 6);
      let attempt = 0;
      while (!code && attempt < 5) {
        attempt += 1;
        const candidate = this.makeCode(seed || 'ARC');
        const exists = await this.codesRepo.findOne({
          where: { code: candidate },
        });
        if (exists) continue;
        code = await this.codesRepo.save(
          this.codesRepo.create({
            ownerUserId: userId,
            code: candidate,
            status: ReferralCodeStatus.Active,
          }),
        );
      }
      if (!code) {
        throw new AppException(
          AuthErrorCode.VALIDATION_ERROR,
          'Could not create referral code',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }

    let defaultLink = await this.linksRepo.findOne({
      where: {
        ownerUserId: userId,
        campaign: 'default',
        status: ReferralLinkStatus.Active,
      },
      order: { createdAt: 'ASC' },
    });
    if (!defaultLink) {
      defaultLink = await this.linksRepo.save(
        this.linksRepo.create({
          ownerUserId: userId,
          referralCodeId: code.id,
          publicToken: this.makeToken(),
          channel: ReferralShareChannel.CopyLink,
          campaign: 'default',
          locale: 'en',
          status: ReferralLinkStatus.Active,
        }),
      );
    }

    return { code, defaultLink };
  }

  async getMe(userId: string) {
    const { code, defaultLink } = await this.ensureCodeAndDefaultLink(userId);
    const attributions = await this.attributionsRepo.find({
      where: { inviterUserId: userId },
      order: { createdAt: 'DESC' },
      take: 20,
    });

    const qualified = attributions.filter((a) =>
      [
        ReferralAttributionStatus.Qualified,
        ReferralAttributionStatus.Rewarded,
      ].includes(a.status),
    ).length;
    const rewarded = attributions.filter(
      (a) => a.status === ReferralAttributionStatus.Rewarded,
    ).length;
    const signups = attributions.length;

    const clicks = await this.clicksRepo
      .createQueryBuilder('c')
      .innerJoin(ReferralLink, 'l', 'l.id = c.referral_link_id')
      .where('l.owner_user_id = :userId', { userId })
      .andWhere('c.is_eligible = true')
      .getCount();

    const shares = await this.shareEventsRepo.count({ where: { userId } });

    const grants = await this.grantsRepo.find({
      where: { userId, status: ReferralRewardGrantStatus.Granted },
    });
    const coinsEarned = grants.reduce((s, g) => s + g.coins, 0);

    const next =
      REFERRAL_MILESTONES.find((m) => m.qualifiedRequired > qualified) ?? null;

    const recentInvites = await Promise.all(
      attributions.slice(0, 8).map(async (a) => this.toInviteDto(a)),
    );

    const preview = this.rewardPreview();

    return {
      code: code.code,
      defaultUrl: this.linkUrl(defaultLink.publicToken),
      rewardPreview: {
        perQualifiedFriend: preview.perQualifiedFriend,
        friendGets: preview.friendGets,
      },
      stats: {
        shares,
        eligibleClicks: clicks,
        signups,
        qualified,
        rewarded,
        coinsEarned,
      },
      nextMilestone: next
        ? {
            qualifiedRequired: next.qualifiedRequired,
            qualifiedCurrent: qualified,
            reward: { coins: next.coins, gems: next.gems },
          }
        : null,
      recentInvites,
    };
  }

  async listInvites(userId: string, cursor?: string, limit = 20) {
    const take = Math.min(Math.max(limit || 20, 1), 50);
    const qb = this.attributionsRepo
      .createQueryBuilder('a')
      .where('a.inviter_user_id = :userId', { userId })
      .orderBy('a.created_at', 'DESC')
      .take(take + 1);
    if (cursor) {
      qb.andWhere('a.created_at < :cursor', { cursor: new Date(cursor) });
    }
    const rows = await qb.getMany();
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const items = await Promise.all(page.map((a) => this.toInviteDto(a)));
    return {
      items,
      nextCursor: hasMore
        ? page[page.length - 1].createdAt.toISOString()
        : null,
    };
  }

  async listActivity(userId: string, cursor?: string, limit = 30) {
    const invites = await this.listInvites(userId, cursor, limit);
    return {
      items: invites.items.map((i) => ({
        id: i.id,
        status: i.status,
        message: i.message,
        displayName: i.displayName,
        at: i.createdAt,
      })),
      nextCursor: invites.nextCursor,
    };
  }

  async createLink(userId: string, dto: CreateReferralLinkDto) {
    const { code } = await this.ensureCodeAndDefaultLink(userId);
    const link = await this.linksRepo.save(
      this.linksRepo.create({
        ownerUserId: userId,
        referralCodeId: code.id,
        publicToken: this.makeToken(),
        channel: dto.channel,
        campaign: dto.campaign ?? 'friends_hub',
        locale: dto.locale ?? 'en',
        status: ReferralLinkStatus.Active,
      }),
    );
    const preview = this.rewardPreview();
    return {
      linkId: link.id,
      referralCode: code.code,
      url: this.linkUrl(link.publicToken),
      share: {
        title: 'Join me on Arc',
        text: 'Learn with Arlo on Arc. Use my link and we’ll both earn rewards.',
      },
      rewardPreview: {
        inviterCoins: preview.inviterCoins,
        friendCoins: preview.friendCoins,
        friendXp: preview.friendXp,
      },
    };
  }

  async listLinks(userId: string) {
    const links = await this.linksRepo.find({
      where: { ownerUserId: userId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return {
      items: links.map((l) => ({
        id: l.id,
        url: this.linkUrl(l.publicToken),
        channel: l.channel,
        campaign: l.campaign,
        status: l.status,
        clickCount: l.clickCount,
        signupCount: l.signupCount,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  }

  async revokeLink(userId: string, linkId: string) {
    const link = await this.linksRepo.findOne({
      where: { id: linkId, ownerUserId: userId },
    });
    if (!link) {
      throw new AppException(
        AuthErrorCode.REFERRAL_LINK_NOT_FOUND,
        'Link not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (link.status !== ReferralLinkStatus.Active) {
      throw new AppException(
        AuthErrorCode.REFERRAL_LINK_INACTIVE,
        'Link inactive',
        HttpStatus.BAD_REQUEST,
      );
    }
    link.status = ReferralLinkStatus.Revoked;
    link.revokedAt = new Date();
    await this.linksRepo.save(link);
    return { ok: true };
  }

  async rotateCode(userId: string) {
    const current = await this.codesRepo.findOne({
      where: { ownerUserId: userId, status: ReferralCodeStatus.Active },
    });
    if (current) {
      const ageMs = Date.now() - current.createdAt.getTime();
      const cooldown =
        REFERRAL_CODE_ROTATE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
      if (ageMs < cooldown) {
        throw new AppException(
          AuthErrorCode.REFERRAL_CODE_ROTATE_COOLDOWN,
          'Code rotate cooldown active',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      current.status = ReferralCodeStatus.Rotated;
      await this.codesRepo.save(current);
    }

    const profile = await this.profilesRepo.findOne({ where: { userId } });
    const seed =
      profile?.username || profile?.displayName || userId.slice(0, 6);
    let code: ReferralCode | null = null;
    let attempt = 0;
    while (!code && attempt < 5) {
      attempt += 1;
      const candidate = this.makeCode(seed || 'ARC');
      const exists = await this.codesRepo.findOne({
        where: { code: candidate },
      });
      if (exists) continue;
      code = await this.codesRepo.save(
        this.codesRepo.create({
          ownerUserId: userId,
          code: candidate,
          status: ReferralCodeStatus.Active,
          rotatedFromId: current?.id ?? null,
        }),
      );
    }
    if (!code) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'Could not rotate referral code',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return { code: code.code };
  }

  async recordShareEvent(
    userId: string,
    linkId: string,
    dto: ReferralShareEventDto,
  ) {
    const link = await this.linksRepo.findOne({
      where: { id: linkId, ownerUserId: userId },
    });
    if (!link) {
      throw new AppException(
        AuthErrorCode.REFERRAL_LINK_NOT_FOUND,
        'Link not found',
        HttpStatus.NOT_FOUND,
      );
    }
    const existing = await this.shareEventsRepo.findOne({
      where: { userId, clientEventId: dto.clientEventId },
    });
    if (existing) {
      return { ok: true, alreadyRecorded: true };
    }
    await this.shareEventsRepo.save(
      this.shareEventsRepo.create({
        userId,
        referralLinkId: linkId,
        clientEventId: dto.clientEventId,
        eventType: dto.eventType,
        channel: dto.channel ?? link.channel,
      }),
    );
    return { ok: true, alreadyRecorded: false };
  }

  async handlePublicRedirect(token: string, meta?: { ip?: string; ua?: string }) {
    const link = await this.linksRepo.findOne({
      where: { publicToken: token, status: ReferralLinkStatus.Active },
    });
    if (!link) {
      return {
        redirectTo: `${this.appBase()}/register`,
        cookieToken: null as string | null,
      };
    }

    const bot = /bot|crawl|spider|preview|facebookexternalhit|slackbot/i.test(
      meta?.ua ?? '',
    );
    await this.clicksRepo.save(
      this.clicksRepo.create({
        referralLinkId: link.id,
        isEligible: !bot,
        ipHash: meta?.ip
          ? createHash('sha256').update(meta.ip).digest('hex').slice(0, 32)
          : null,
        userAgent: (meta?.ua ?? '').slice(0, 255) || null,
      }),
    );
    if (!bot) {
      link.clickCount += 1;
      await this.linksRepo.save(link);
    }

    return {
      redirectTo: `${this.appBase()}/register`,
      cookieToken: bot ? null : link.publicToken,
      cookieMaxAgeSec: REFERRAL_COOKIE_TTL_DAYS * 24 * 60 * 60,
    };
  }

  async attachOnRegister(input: {
    inviteeUserId: string;
    referralCode?: string | null;
    referralToken?: string | null;
  }) {
    const existing = await this.attributionsRepo.findOne({
      where: { inviteeUserId: input.inviteeUserId },
    });
    if (existing) return existing;

    let link: ReferralLink | null = null;
    let code: ReferralCode | null = null;

    if (input.referralCode) {
      code = await this.codesRepo.findOne({
        where: {
          code: input.referralCode.trim().toUpperCase(),
          status: ReferralCodeStatus.Active,
        },
      });
    }
    if (!code && input.referralToken) {
      link = await this.linksRepo.findOne({
        where: {
          publicToken: input.referralToken,
          status: ReferralLinkStatus.Active,
        },
      });
      if (link) {
        code = await this.codesRepo.findOne({
          where: { id: link.referralCodeId },
        });
      }
    }
    if (!code) return null;
    if (code.ownerUserId === input.inviteeUserId) return null;

    const inviter = await this.usersRepo.findOneBy({ id: code.ownerUserId });
    if (!inviter?.isActive) {
      throw new AppException(
        AuthErrorCode.REFERRAL_INVITER_INELIGIBLE,
        'Inviter ineligible',
        HttpStatus.BAD_REQUEST,
      );
    }

    const attribution = await this.attributionsRepo.save(
      this.attributionsRepo.create({
        inviterUserId: code.ownerUserId,
        inviteeUserId: input.inviteeUserId,
        referralCodeId: code.id,
        referralLinkId: link?.id ?? null,
        status: ReferralAttributionStatus.Registered,
        expiresAt: new Date(
          Date.now() + REFERRAL_QUALIFY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        ),
      }),
    );

    if (link) {
      link.signupCount += 1;
      await this.linksRepo.save(link);
    }

    // Pending preview grants (not wallet-credited yet)
    await this.grantsRepo.save([
      this.grantsRepo.create({
        attributionId: attribution.id,
        userId: attribution.inviterUserId,
        coins: REFERRAL_INVITER_COINS,
        gems: 0,
        xp: 0,
        status: ReferralRewardGrantStatus.Pending,
        idempotencyKey: `referral:${attribution.id}:inviter:base`,
        kind: 'inviter_base',
        ledgerTransactionGroupId: null,
      }),
      this.grantsRepo.create({
        attributionId: attribution.id,
        userId: attribution.inviteeUserId,
        coins: REFERRAL_FRIEND_COINS,
        gems: 0,
        xp: REFERRAL_FRIEND_XP,
        status: ReferralRewardGrantStatus.Pending,
        idempotencyKey: `referral:${attribution.id}:invitee:base`,
        kind: 'invitee_base',
        ledgerTransactionGroupId: null,
      }),
    ]);

    await this.notifications.create({
      userId: input.inviteeUserId,
      type: NotificationType.Referral,
      title: 'Welcome reward pending',
      body: `Finish your first mission to unlock +${REFERRAL_FRIEND_COINS} Coins and +${REFERRAL_FRIEND_XP} XP.`,
      actionUrl: '/home',
      dedupeKey: `referral-pending:${attribution.id}:invitee`,
      payload: { attributionId: attribution.id },
    });
    await this.notifications.create({
      userId: attribution.inviterUserId,
      type: NotificationType.Referral,
      title: 'Friend signed up',
      body: 'Your invite joined Arc. Reward pending until they qualify.',
      actionUrl: '/friends',
      dedupeKey: `referral-signup:${attribution.id}:inviter`,
      payload: { attributionId: attribution.id },
    });

    // If OAuth already verified email, advance immediately
    void this.evaluateInvitee(input.inviteeUserId).catch((err) => {
      this.logger.warn(
        `evaluate after attach failed: ${err instanceof Error ? err.message : err}`,
      );
    });

    return attribution;
  }

  async claimCode(userId: string, rawCode: string) {
    const user = await this.usersRepo.findOneBy({ id: userId });
    if (!user) {
      throw new AppException(
        AuthErrorCode.UNAUTHORIZED,
        'User not found',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (user.emailVerifiedAt) {
      const existing = await this.attributionsRepo.findOne({
        where: { inviteeUserId: userId },
      });
      if (existing) {
        throw new AppException(
          AuthErrorCode.REFERRAL_ALREADY_ATTRIBUTED,
          'Referral already attached',
          HttpStatus.CONFLICT,
        );
      }
    }

    const ageMs = Date.now() - user.createdAt.getTime();
    if (ageMs > REFERRAL_MANUAL_CLAIM_HOURS * 60 * 60 * 1000) {
      throw new AppException(
        AuthErrorCode.REFERRAL_CLAIM_WINDOW_CLOSED,
        'Manual claim window closed',
        HttpStatus.BAD_REQUEST,
      );
    }

    const code = await this.codesRepo.findOne({
      where: {
        code: rawCode.trim().toUpperCase(),
        status: ReferralCodeStatus.Active,
      },
    });
    if (!code) {
      throw new AppException(
        AuthErrorCode.REFERRAL_CODE_NOT_FOUND,
        'Referral code not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (code.ownerUserId === userId) {
      throw new AppException(
        AuthErrorCode.REFERRAL_SELF_NOT_ALLOWED,
        'Cannot use your own code',
        HttpStatus.BAD_REQUEST,
      );
    }

    const existing = await this.attributionsRepo.findOne({
      where: { inviteeUserId: userId },
    });
    if (existing) {
      throw new AppException(
        AuthErrorCode.REFERRAL_ALREADY_ATTRIBUTED,
        'Referral already attached',
        HttpStatus.CONFLICT,
      );
    }

    const attribution = await this.attachOnRegister({
      inviteeUserId: userId,
      referralCode: code.code,
    });
    return { ok: true, attributionId: attribution?.id ?? null };
  }

  /** Full qualification re-check — call after verify / onboarding / lesson. */
  async evaluateInvitee(inviteeUserId: string) {
    const attr = await this.attributionsRepo.findOne({
      where: { inviteeUserId },
    });
    if (!attr) return null;
    if (
      [
        ReferralAttributionStatus.Rewarded,
        ReferralAttributionStatus.Rejected,
        ReferralAttributionStatus.Expired,
      ].includes(attr.status)
    ) {
      return attr;
    }

    if (attr.status === ReferralAttributionStatus.UnderReview) {
      return attr;
    }

    if (attr.expiresAt < new Date()) {
      attr.status = ReferralAttributionStatus.Expired;
      await this.attributionsRepo.save(attr);
      return attr;
    }

    const checks = await this.qualificationChecks(inviteeUserId);
    let nextStatus = ReferralAttributionStatus.Registered;

    if (checks.emailVerified) {
      nextStatus = ReferralAttributionStatus.EmailVerified;
    }
    if (checks.questionnaireDone && checks.roadmapReady) {
      nextStatus = ReferralAttributionStatus.OnboardingCompleted;
    }
    if (
      checks.questionnaireDone &&
      checks.roadmapReady &&
      !checks.firstLessonDone
    ) {
      nextStatus = ReferralAttributionStatus.AlmostThere;
    }
    if (checks.allPassed) {
      nextStatus = ReferralAttributionStatus.Qualified;
    }

    const order = [
      ReferralAttributionStatus.Registered,
      ReferralAttributionStatus.EmailVerified,
      ReferralAttributionStatus.OnboardingCompleted,
      ReferralAttributionStatus.AlmostThere,
      ReferralAttributionStatus.Qualified,
    ];
    if (order.indexOf(nextStatus) > order.indexOf(attr.status)) {
      attr.status = nextStatus;
      await this.attributionsRepo.save(attr);
    }

    if (checks.allPassed) {
      return this.settleIfQualified(attr.id);
    }
    return attr;
  }

  /** @deprecated prefer evaluateInvitee — kept for callers */
  async progressInvitee(
    inviteeUserId: string,
    _stage: ReferralAttributionStatus,
  ) {
    return this.evaluateInvitee(inviteeUserId);
  }

  async settleIfQualified(attributionId: string) {
    if (!this.gamification) {
      this.logger.error('GamificationService missing — cannot settle referral');
      return null;
    }
    const gamification = this.gamification;

    return this.dataSource
      .transaction(async (manager) => {
        const attrRepo = manager.getRepository(ReferralAttribution);
        const attr = await attrRepo.findOne({
          where: { id: attributionId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!attr) return null;
        if (attr.status === ReferralAttributionStatus.Rewarded) return attr;

        const risk = await manager.getRepository(ReferralRiskReview).findOne({
          where: {
            attributionId: attr.id,
            status: ReferralRiskStatus.Held,
          },
        });
        if (risk || attr.status === ReferralAttributionStatus.UnderReview) {
          throw new AppException(
            AuthErrorCode.REFERRAL_UNDER_REVIEW,
            'Referral under review',
            HttpStatus.FORBIDDEN,
          );
        }

        if (attr.expiresAt < new Date()) {
          attr.status = ReferralAttributionStatus.Expired;
          await attrRepo.save(attr);
          throw new AppException(
            AuthErrorCode.REFERRAL_QUALIFICATION_EXPIRED,
            'Qualification window ended',
            HttpStatus.BAD_REQUEST,
          );
        }

        const checks = await this.qualificationChecks(attr.inviteeUserId);
        if (!checks.allPassed) {
          return attr;
        }

        attr.status = ReferralAttributionStatus.Qualified;
        attr.qualifiedAt = new Date();
        await attrRepo.save(attr);

        const grantRepo = manager.getRepository(ReferralRewardGrant);
        const inviterKey = `referral:${attr.id}:inviter:base`;
        const inviteeKey = `referral:${attr.id}:invitee:base`;

        let inviterGrant = await grantRepo.findOne({
          where: { idempotencyKey: inviterKey },
        });
        if (
          !inviterGrant ||
          inviterGrant.status !== ReferralRewardGrantStatus.Granted
        ) {
          const grant = await gamification.grantInTx(manager, {
            userId: attr.inviterUserId,
            reasonType: RewardReasonType.Referral,
            reasonId: attr.id,
            idempotencyKey: inviterKey,
            metadata: { countsForLeague: false, role: 'inviter' },
            lines: [
              {
                currency: RewardCurrency.Coins,
                amount: REFERRAL_INVITER_COINS,
                idempotencySuffix: 'coins',
              },
            ],
          });
          if (!inviterGrant) {
            inviterGrant = grantRepo.create({
              attributionId: attr.id,
              userId: attr.inviterUserId,
              coins: REFERRAL_INVITER_COINS,
              gems: 0,
              xp: 0,
              status: ReferralRewardGrantStatus.Granted,
              idempotencyKey: inviterKey,
              kind: 'inviter_base',
              ledgerTransactionGroupId: grant.transactionGroupId,
            });
          } else {
            inviterGrant.status = ReferralRewardGrantStatus.Granted;
            inviterGrant.ledgerTransactionGroupId = grant.transactionGroupId;
          }
          await grantRepo.save(inviterGrant);
        }

        let inviteeGrant = await grantRepo.findOne({
          where: { idempotencyKey: inviteeKey },
        });
        if (
          !inviteeGrant ||
          inviteeGrant.status !== ReferralRewardGrantStatus.Granted
        ) {
          const grant = await gamification.grantInTx(manager, {
            userId: attr.inviteeUserId,
            reasonType: RewardReasonType.Referral,
            reasonId: attr.id,
            idempotencyKey: inviteeKey,
            metadata: { countsForLeague: false, role: 'invitee' },
            lines: [
              {
                currency: RewardCurrency.Coins,
                amount: REFERRAL_FRIEND_COINS,
                idempotencySuffix: 'coins',
              },
              {
                currency: RewardCurrency.LifetimeXp,
                amount: REFERRAL_FRIEND_XP,
                idempotencySuffix: 'xp',
              },
            ],
          });
          if (!inviteeGrant) {
            inviteeGrant = grantRepo.create({
              attributionId: attr.id,
              userId: attr.inviteeUserId,
              coins: REFERRAL_FRIEND_COINS,
              gems: 0,
              xp: REFERRAL_FRIEND_XP,
              status: ReferralRewardGrantStatus.Granted,
              idempotencyKey: inviteeKey,
              kind: 'invitee_base',
              ledgerTransactionGroupId: grant.transactionGroupId,
            });
          } else {
            inviteeGrant.status = ReferralRewardGrantStatus.Granted;
            inviteeGrant.ledgerTransactionGroupId = grant.transactionGroupId;
            inviteeGrant.xp = REFERRAL_FRIEND_XP;
          }
          await grantRepo.save(inviteeGrant);
        }

        attr.status = ReferralAttributionStatus.Rewarded;
        attr.rewardedAt = new Date();
        await attrRepo.save(attr);

        await this.evaluateMilestones(manager, attr.inviterUserId, gamification);

        return attr;
      })
      .then(async (attr) => {
        if (!attr || attr.status !== ReferralAttributionStatus.Rewarded) {
          return attr;
        }
        await this.notifications.create({
          userId: attr.inviterUserId,
          type: NotificationType.Referral,
          title: 'Referral reward unlocked',
          body: `+${REFERRAL_INVITER_COINS} Coins — your friend qualified.`,
          actionUrl: '/friends',
          dedupeKey: `referral-rewarded:${attr.id}:inviter`,
          payload: { attributionId: attr.id },
        });
        await this.notifications.create({
          userId: attr.inviteeUserId,
          type: NotificationType.Referral,
          title: 'Welcome reward unlocked',
          body: `+${REFERRAL_FRIEND_COINS} Coins and +${REFERRAL_FRIEND_XP} XP.`,
          actionUrl: '/wallet',
          dedupeKey: `referral-rewarded:${attr.id}:invitee`,
          payload: { attributionId: attr.id },
        });
        return attr;
      });
  }

  private async qualificationChecks(inviteeUserId: string) {
    const user = await this.usersRepo.findOneBy({ id: inviteeUserId });
    const profile = await this.profilesRepo.findOne({
      where: { userId: inviteeUserId },
    });
    const emailVerified = Boolean(user?.emailVerifiedAt) && Boolean(user?.isActive);
    const questionnaireDone =
      profile?.questionnaireStatus === QuestionnaireStatus.Completed;

    const roadmap = await this.dataSource.getRepository(Roadmap).findOne({
      where: { userId: inviteeUserId, status: RoadmapStatus.Ready },
      order: { createdAt: 'DESC' },
    });
    const roadmapReady = Boolean(roadmap);

    const progressRepo = this.dataSource.getRepository(LessonProgress);
    const completed = await progressRepo.find({
      where: {
        userId: inviteeUserId,
        status: LessonProgressStatus.Completed,
      },
      take: 20,
    });
    const firstLessonDone = completed.length > 0;
    const studyMinutes = completed.reduce(
      (s, p) => s + (p.timeSpentMinutes || 0),
      0,
    );
    const studyMinutesOk = studyMinutes >= REFERRAL_MIN_STUDY_MINUTES;

    const allPassed =
      emailVerified &&
      questionnaireDone &&
      roadmapReady &&
      firstLessonDone &&
      studyMinutesOk;

    return {
      emailVerified,
      questionnaireDone,
      roadmapReady,
      firstLessonDone,
      studyMinutes,
      studyMinutesOk,
      allPassed,
    };
  }

  private async evaluateMilestones(
    manager: DataSource['manager'],
    inviterUserId: string,
    gamification: GamificationService,
  ) {
    const rewarded = await manager.getRepository(ReferralAttribution).count({
      where: {
        inviterUserId,
        status: ReferralAttributionStatus.Rewarded,
      },
    });
    const milestoneRepo = manager.getRepository(ReferralMilestone);
    const grantRepo = manager.getRepository(ReferralRewardGrant);

    for (const m of REFERRAL_MILESTONES) {
      if (rewarded < m.qualifiedRequired) continue;
      const existing = await milestoneRepo.findOne({
        where: {
          userId: inviterUserId,
          qualifiedRequired: m.qualifiedRequired,
        },
      });
      if (existing) continue;

      const key = `referral:${inviterUserId}:milestone:${m.qualifiedRequired}`;
      const priorGrant = await grantRepo.findOne({
        where: { idempotencyKey: key },
      });
      if (!priorGrant) {
        const lines: Array<{
          currency: RewardCurrency;
          amount: number;
          idempotencySuffix: string;
        }> = [];
        if (m.coins > 0) {
          lines.push({
            currency: RewardCurrency.Coins,
            amount: m.coins,
            idempotencySuffix: 'coins',
          });
        }
        if (m.gems > 0) {
          lines.push({
            currency: RewardCurrency.Gems,
            amount: m.gems,
            idempotencySuffix: 'gems',
          });
        }
        const grant = await gamification.grantInTx(manager, {
          userId: inviterUserId,
          reasonType: RewardReasonType.Referral,
          reasonId: `milestone:${m.qualifiedRequired}`,
          idempotencyKey: key,
          metadata: {
            countsForLeague: false,
            milestone: m.qualifiedRequired,
          },
          lines,
        });
        await grantRepo.save(
          grantRepo.create({
            attributionId: null,
            userId: inviterUserId,
            coins: m.coins,
            gems: m.gems,
            xp: 0,
            status: ReferralRewardGrantStatus.Granted,
            idempotencyKey: key,
            kind: `milestone_${m.qualifiedRequired}`,
            ledgerTransactionGroupId: grant.transactionGroupId,
          }),
        );

        if (m.badge) {
          const isFrame = /frame/i.test(m.badge);
          if (isFrame) {
            const sku = `frame-referral-${m.qualifiedRequired}`;
            const invRepo = manager.getRepository(UserInventoryItem);
            const owned = await invRepo.findOne({
              where: { userId: inviterUserId, sku },
            });
            if (!owned) {
              await invRepo.save(
                invRepo.create({
                  userId: inviterUserId,
                  sku,
                  quantity: 1,
                  equipped: false,
                  acquiredFrom: 'referral',
                  payload: { slot: 'frame', label: m.badge },
                }),
              );
            }
          } else {
            const badgeId = `referral-${m.qualifiedRequired}`;
            const badgeRepo = manager.getRepository(UserBadge);
            const owned = await badgeRepo.findOne({
              where: { userId: inviterUserId, badgeId },
            });
            if (!owned) {
              await badgeRepo.save(
                badgeRepo.create({
                  userId: inviterUserId,
                  badgeId,
                  badgeLabel: m.badge,
                }),
              );
            }
          }
        }
      }

      await milestoneRepo.save(
        milestoneRepo.create({
          userId: inviterUserId,
          qualifiedRequired: m.qualifiedRequired,
          coinsAwarded: m.coins,
          gemsAwarded: m.gems,
          badge: m.badge ?? null,
        }),
      );

      await this.notifications.create({
        userId: inviterUserId,
        type: NotificationType.Referral,
        title: 'Referral milestone',
        body: `Hit ${m.qualifiedRequired} qualified friends — bonus unlocked.`,
        actionUrl: '/friends',
        dedupeKey: `referral-milestone:${inviterUserId}:${m.qualifiedRequired}`,
      });
    }
  }

  private async toInviteDto(a: ReferralAttribution) {
    const profile = await this.profilesRepo.findOne({
      where: { userId: a.inviteeUserId },
    });
    const name = profile?.displayName || profile?.username || 'Friend';
    const masked = name.length <= 1 ? 'F***' : `${name[0]}***`;
    return {
      id: a.id,
      displayName: masked,
      status: a.status,
      message: this.statusMessage(a.status),
      createdAt: a.createdAt.toISOString(),
    };
  }

  private statusMessage(status: ReferralAttributionStatus): string {
    switch (status) {
      case ReferralAttributionStatus.Registered:
        return 'Signed up';
      case ReferralAttributionStatus.EmailVerified:
        return 'Email verified';
      case ReferralAttributionStatus.OnboardingCompleted:
        return 'Learning started';
      case ReferralAttributionStatus.AlmostThere:
        return 'First required lesson still needed';
      case ReferralAttributionStatus.Qualified:
        return 'Qualified';
      case ReferralAttributionStatus.Rewarded:
        return 'Rewarded';
      case ReferralAttributionStatus.Expired:
        return 'Expired';
      case ReferralAttributionStatus.Rejected:
        return 'Rejected';
      case ReferralAttributionStatus.UnderReview:
        return 'Under review';
      default:
        return status;
    }
  }
}
