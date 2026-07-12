import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { GamificationService } from '../gamification/gamification.service';
import {
  RewardCurrency,
  RewardReasonType,
} from '../gamification/entities/reward-ledger-entry.entity';
import { UserInventoryItem } from '../gamification/entities/user-inventory-item.entity';
import { UserBadge } from '../lessons/entities/user-badge.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { ProfilesService } from '../profiles/profiles.service';
import {
  localParts,
  resolveTz,
  toDateString,
  zonedTimeToUtc,
} from '../weeks/weeks.time';
import { WheelCampaign } from './entities/wheel-campaign.entity';
import { WheelRewardInventory } from './entities/wheel-reward-inventory.entity';
import { WheelSegmentRule } from './entities/wheel-segment-rule.entity';
import { WheelSpin } from './entities/wheel-spin.entity';
import {
  LayoutSegmentSnapshot,
  WheelUserDay,
} from './entities/wheel-user-day.entity';
import {
  WheelCampaignStatus,
  WheelEntitlementType,
  WheelRewardType,
  WheelSpinStatus,
} from './entities/wheel.enums';
import { WheelLayoutService } from './wheel-layout.service';
import { WheelRngService } from './wheel-rng.service';
import {
  DEFAULT_SEGMENT_SEED,
  WHEEL_DAILY_GEMS_CAP,
  WHEEL_DAILY_XP_CAP,
  WHEEL_DEFAULT_SLUG,
  WHEEL_RESPIN_GEM_PRICE,
} from './wheel.constants';

@Injectable()
export class LuckyWheelService implements OnModuleInit {
  private readonly logger = new Logger(LuckyWheelService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly gamification: GamificationService,
    private readonly profiles: ProfilesService,
    private readonly notifications: NotificationsService,
    private readonly layout: WheelLayoutService,
    private readonly rng: WheelRngService,
    @InjectRepository(WheelCampaign)
    private readonly campaignsRepo: Repository<WheelCampaign>,
    @InjectRepository(WheelSegmentRule)
    private readonly rulesRepo: Repository<WheelSegmentRule>,
    @InjectRepository(WheelUserDay)
    private readonly daysRepo: Repository<WheelUserDay>,
    @InjectRepository(WheelSpin)
    private readonly spinsRepo: Repository<WheelSpin>,
    @InjectRepository(WheelRewardInventory)
    private readonly inventoryRepo: Repository<WheelRewardInventory>,
  ) {}

  async onModuleInit() {
    if (process.env.WHEEL_SEED === 'false') return;
    try {
      await this.ensureDefaultCampaign();
    } catch (err) {
      this.logger.warn(
        `Wheel seed skipped: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async getCurrent(userId: string) {
    const { campaign, userDay, profileTz } =
      await this.resolveUserDay(userId);
    const spinsAvailable = this.spinsAvailable(userDay);
    const serverNow = new Date();
    return {
      serverNow: serverNow.toISOString(),
      rewardDay: userDay.rewardDay,
      campaignSlug: campaign.slug,
      spinsAvailable,
      spinsPerDay: campaign.maxFreeSpinsPerDay,
      nextSpinAt: userDay.nextSpinAt?.toISOString() ?? null,
      resetsAt: userDay.dayEndAt.toISOString(),
      layoutVersion: userDay.layoutVersion,
      segments: userDay.layoutSnapshot.map((s) => ({
        id: s.id,
        label: s.label,
        kind: this.clientKind(s.rewardType),
        amount: s.amount,
        color: s.color,
      })),
      previewGems: WHEEL_DAILY_GEMS_CAP,
      timezone: profileTz,
      respinGemPrice: campaign.respinGemPrice ?? WHEEL_RESPIN_GEM_PRICE,
      paidRespinsLeft: Math.max(
        0,
        campaign.maxPaidRespinsPerDay - userDay.paidSpinsTotal,
      ),
    };
  }

  async spin(userId: string, idempotencyKey: string) {
    if (!idempotencyKey?.trim()) {
      throw new AppException(
        AuthErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        'Idempotency-Key required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const existing = await this.spinsRepo.findOne({
      where: { userId, idempotencyKey: idempotencyKey.trim() },
    });
    if (existing) {
      return this.toSpinResponse(existing, userId);
    }

    return this.dataSource.transaction(async (manager) => {
      const { campaign, userDay } = await this.resolveUserDay(
        userId,
        manager,
        true,
      );

      const available = this.spinsAvailable(userDay);
      if (available <= 0) {
        throw new AppException(
          AuthErrorCode.WHEEL_NO_SPINS_LEFT,
          'No spins left today',
          HttpStatus.CONFLICT,
        );
      }
      if (userDay.nextSpinAt && userDay.nextSpinAt.getTime() > Date.now()) {
        throw new AppException(
          AuthErrorCode.WHEEL_SPIN_TOO_EARLY,
          'Spin not ready yet',
          HttpStatus.CONFLICT,
        );
      }

      const layout = userDay.layoutSnapshot;
      if (!layout?.length) {
        throw new AppException(
          AuthErrorCode.WHEEL_LAYOUT_INVALID,
          'Wheel layout missing',
        );
      }

      const weights = layout.map((s) => Math.max(0, s.weight));
      const { index, rngValue } = this.rng.pickWeighted(weights);
      let segment = layout[index];

      // Cap clamp at award time
      segment = this.clampSegmentCaps(segment, userDay);

      const entitlement = this.consumeEntitlementType(userDay);
      const spinRepo = manager.getRepository(WheelSpin);

      const spin = await spinRepo.save(
        spinRepo.create({
          userId,
          userDayId: userDay.id,
          spinNumber: userDay.spinsUsed + 1,
          entitlementType: entitlement,
          winningSegmentId: segment.id,
          landingIndex: index,
          rewardKey: segment.rewardKey,
          rewardSnapshot: {
            type: segment.rewardType,
            amount: segment.amount,
            label: segment.label,
            payload: segment.payload,
          },
          rngValue: String(rngValue),
          idempotencyKey: idempotencyKey.trim().slice(0, 128),
          status: WheelSpinStatus.Reserved,
        }),
      );

      const grant = await this.awardReward(manager, userId, spin, segment);

      spin.status = WheelSpinStatus.Awarded;
      spin.ledgerTransactionId = grant.transactionGroupId;
      spin.replacementReason = grant.replacementReason;
      await spinRepo.save(spin);

      userDay.spinsUsed += 1;
      if (segment.rewardType === WheelRewardType.Gems) {
        userDay.gemsAwardedToday += segment.amount;
      }
      if (segment.rewardType === WheelRewardType.LifetimeXp) {
        userDay.xpAwardedToday += segment.amount;
      }

      if (
        segment.rewardType === WheelRewardType.TryAgain ||
        segment.rewardType === WheelRewardType.ExtraSpin
      ) {
        if (userDay.extraSpinsTotal < 1) {
          userDay.extraSpinsTotal += 1;
        }
      } else if (segment.rewardType === WheelRewardType.Badge) {
        const rules = await manager.getRepository(WheelSegmentRule).find({
          where: { campaignId: campaign.id, isActive: true },
        });
        const badges = await this.loadBadgeIds(manager, userId);
        const replaced = this.layout.replaceSegment(
          userDay.layoutSnapshot,
          segment.id,
          rules,
          {
            rankLevel: 1,
            gemsAwardedToday: userDay.gemsAwardedToday,
            xpAwardedToday: userDay.xpAwardedToday,
            ownedBadgeIds: badges,
            inventoryAvailable: new Map(),
          },
          'unique_reward_already_owned',
        );
        userDay.layoutSnapshot = replaced.layout;
        userDay.layoutVersion += 1;
      }

      await manager.getRepository(WheelUserDay).save(userDay);

      this.logger.log(
        `wheel_spin_awarded user=${userId} key=${segment.rewardKey} spin=${spin.id}`,
      );

      if (
        segment.rewardType === WheelRewardType.Badge ||
        (segment.rewardType === WheelRewardType.Gems && segment.amount >= 10)
      ) {
        void this.notifications.create({
          userId,
          type: NotificationType.LuckyWheelReward,
          title: 'Lucky Wheel prize!',
          body: segment.label,
          actionUrl: '/lucky-wheel',
          payload: { spinId: spin.id, rewardKey: segment.rewardKey },
        });
      }

      return this.toSpinResponse(spin, userId, userDay, grant.wallet);
    });
  }

  async purchaseRespin(userId: string, idempotencyKey: string) {
    if (!idempotencyKey?.trim()) {
      throw new AppException(
        AuthErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        'Idempotency-Key required',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const { campaign, userDay } = await this.resolveUserDay(
        userId,
        manager,
        true,
      );
      if (userDay.paidSpinsTotal >= campaign.maxPaidRespinsPerDay) {
        throw new AppException(
          AuthErrorCode.WHEEL_RESPIN_LIMIT_REACHED,
          'Daily gem re-spin limit reached',
          HttpStatus.CONFLICT,
        );
      }
      if (!userDay.layoutSnapshot?.length) {
        throw new AppException(
          AuthErrorCode.WHEEL_LAYOUT_INVALID,
          'Cannot purchase respin without layout',
        );
      }

      const price = campaign.respinGemPrice ?? WHEEL_RESPIN_GEM_PRICE;
      const wallet = await this.gamification.ensureWalletInTx(manager, userId);
      if (wallet.gems < price) {
        throw new AppException(
          AuthErrorCode.INSUFFICIENT_GEMS,
          'Insufficient gems',
        );
      }

      const grant = await this.gamification.grantInTx(manager, {
        userId,
        reasonType: RewardReasonType.Wheel,
        reasonId: userDay.id,
        idempotencyKey: `wheel-respin:${idempotencyKey.trim()}`,
        metadata: { kind: 'gem_respin_purchase', price },
        lines: [
          {
            currency: RewardCurrency.Gems,
            amount: -price,
            idempotencySuffix: 'gems',
          },
        ],
      });

      if (!grant.alreadyGranted) {
        userDay.paidSpinsTotal += 1;
        await manager.getRepository(WheelUserDay).save(userDay);
        this.logger.log(`wheel_respin_purchased user=${userId}`);
      }

      return {
        alreadyPurchased: grant.alreadyGranted,
        spinsAvailable: this.spinsAvailable(userDay),
        paidRespinsLeft: Math.max(
          0,
          campaign.maxPaidRespinsPerDay - userDay.paidSpinsTotal,
        ),
        wallet: grant.wallet,
      };
    });
  }

  async history(userId: string, cursor?: string) {
    const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
    const limit = 20;
    const [rows, total] = await this.spinsRepo.findAndCount({
      where: { userId, status: WheelSpinStatus.Awarded },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return {
      items: rows.map((s) => ({
        spinId: s.id,
        rewardKey: s.rewardKey,
        reward: s.rewardSnapshot,
        landingIndex: s.landingIndex,
        createdAt: s.createdAt.toISOString(),
      })),
      nextCursor: offset + limit < total ? String(offset + limit) : null,
      total,
    };
  }

  async getSpin(userId: string, spinId: string) {
    const spin = await this.spinsRepo.findOne({
      where: { id: spinId, userId },
    });
    if (!spin) {
      throw new AppException(
        AuthErrorCode.WHEEL_REWARD_UNAVAILABLE,
        'Spin not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.toSpinResponse(spin, userId);
  }

  private spinsAvailable(day: WheelUserDay): number {
    const total =
      day.freeSpinsTotal + day.paidSpinsTotal + day.extraSpinsTotal;
    return Math.max(0, total - day.spinsUsed);
  }

  private consumeEntitlementType(day: WheelUserDay): WheelEntitlementType {
    const freeLeft = day.freeSpinsTotal - Math.min(day.spinsUsed, day.freeSpinsTotal);
    // Approximate: first free, then paid, then extra
    if (day.spinsUsed < day.freeSpinsTotal) return WheelEntitlementType.Free;
    const afterFree = day.spinsUsed - day.freeSpinsTotal;
    if (afterFree < day.paidSpinsTotal) return WheelEntitlementType.GemRespin;
    return WheelEntitlementType.Extra;
    void freeLeft;
  }

  private clampSegmentCaps(
    segment: LayoutSegmentSnapshot,
    day: WheelUserDay,
  ): LayoutSegmentSnapshot {
    if (segment.rewardType === WheelRewardType.Gems) {
      const room = Math.max(0, WHEEL_DAILY_GEMS_CAP - day.gemsAwardedToday);
      if (segment.amount > room) {
        if (room <= 0) {
          return {
            ...segment,
            rewardType: WheelRewardType.Coins,
            rewardKey: 'coins_50',
            amount: 50,
            label: '50 Coins',
          };
        }
        return {
          ...segment,
          amount: room,
          label: `${room} Gems`,
        };
      }
    }
    if (segment.rewardType === WheelRewardType.LifetimeXp) {
      const room = Math.max(0, WHEEL_DAILY_XP_CAP - day.xpAwardedToday);
      if (segment.amount > room) {
        return {
          ...segment,
          amount: room,
          label: `${room} XP`,
        };
      }
    }
    return segment;
  }

  private async awardReward(
    manager: EntityManager,
    userId: string,
    spin: WheelSpin,
    segment: LayoutSegmentSnapshot,
  ): Promise<{
    transactionGroupId: string | null;
    wallet: {
      lifetimeXp: number;
      gems: number;
      coins: number;
      version: number;
    };
    replacementReason: string | null;
  }> {
    const type = segment.rewardType as WheelRewardType;
    const amount = segment.amount;

    if (
      type === WheelRewardType.TryAgain ||
      type === WheelRewardType.ExtraSpin
    ) {
      const wallet = await this.gamification.ensureWalletInTx(manager, userId);
      return {
        transactionGroupId: null,
        wallet: {
          lifetimeXp: wallet.lifetimeXp,
          gems: wallet.gems,
          coins: wallet.coins,
          version: wallet.version,
        },
        replacementReason: null,
      };
    }

    if (type === WheelRewardType.Badge) {
      const badgeId = String(segment.payload?.badgeId ?? 'lucky-wheel');
      const badgeLabel = String(
        segment.payload?.badgeLabel ?? segment.label ?? 'Lucky Wheel',
      );
      const badgeRepo = manager.getRepository(UserBadge);
      const existing = await badgeRepo.findOne({
        where: { userId, badgeId },
      });
      if (!existing) {
        await badgeRepo.save(
          badgeRepo.create({ userId, badgeId, badgeLabel }),
        );
      }
      const wallet = await this.gamification.ensureWalletInTx(manager, userId);
      // Probe ledger for audit (0 XP, no league)
      const grant = await this.gamification.grantInTx(manager, {
        userId,
        reasonType: RewardReasonType.Wheel,
        reasonId: spin.id,
        idempotencyKey: `wheel-spin:${spin.id}`,
        metadata: {
          rewardType: type,
          badgeId,
          countsForLeague: false,
        },
        lines: [
          {
            currency: RewardCurrency.LifetimeXp,
            amount: 0,
            idempotencySuffix: 'probe',
          },
        ],
      });
      return {
        transactionGroupId: grant.transactionGroupId,
        wallet: grant.wallet,
        replacementReason: existing ? 'badge_already_owned' : null,
      };
    }

    if (type === WheelRewardType.StreakFreeze || type === WheelRewardType.InventoryItem) {
      const sku = String(segment.payload?.sku ?? segment.rewardKey);
      const inv = manager.getRepository(UserInventoryItem);
      const row = await inv.findOne({ where: { userId, sku } });
      if (row) {
        row.quantity += 1;
        await inv.save(row);
      } else {
        await inv.save(
          inv.create({
            userId,
            sku,
            quantity: 1,
            acquiredFrom: 'lucky_wheel',
            payload: {
              kind:
                type === WheelRewardType.StreakFreeze
                  ? 'streak_freeze'
                  : 'cosmetic',
              days: 1,
              ...segment.payload,
            },
          }),
        );
      }
    }

    const lines: Array<{
      currency: RewardCurrency;
      amount: number;
      idempotencySuffix: string;
    }> = [];

    if (type === WheelRewardType.Coins && amount > 0) {
      lines.push({
        currency: RewardCurrency.Coins,
        amount,
        idempotencySuffix: 'coins',
      });
    }
    if (type === WheelRewardType.Gems && amount > 0) {
      lines.push({
        currency: RewardCurrency.Gems,
        amount,
        idempotencySuffix: 'gems',
      });
    }
    if (type === WheelRewardType.LifetimeXp && amount > 0) {
      // Lifetime only — never LeagueXp
      lines.push({
        currency: RewardCurrency.LifetimeXp,
        amount,
        idempotencySuffix: 'xp',
      });
    }

    if (!lines.length) {
      lines.push({
        currency: RewardCurrency.LifetimeXp,
        amount: 0,
        idempotencySuffix: 'probe',
      });
    }

    const grant = await this.gamification.grantInTx(manager, {
      userId,
      reasonType: RewardReasonType.Wheel,
      reasonId: spin.id,
      idempotencyKey: `wheel-spin:${spin.id}`,
      metadata: {
        rewardType: type,
        rewardKey: segment.rewardKey,
        countsForLeague: false,
      },
      lines,
    });

    return {
      transactionGroupId: grant.transactionGroupId,
      wallet: grant.wallet,
      replacementReason: null,
    };
  }

  private async resolveUserDay(
    userId: string,
    manager?: EntityManager,
    forUpdate = false,
  ) {
    const campaign = await this.getActiveCampaign(manager);
    const profile = await this.profiles.findByUserId(userId);
    const tz = resolveTz(profile?.timezone);
    const { rewardDay, dayStartAt, dayEndAt } = this.rewardDayBounds(
      new Date(),
      tz,
    );

    const daysRepo = manager
      ? manager.getRepository(WheelUserDay)
      : this.daysRepo;

    let userDay = forUpdate
      ? await daysRepo.findOne({
          where: {
            userId,
            campaignId: campaign.id,
            rewardDay,
          },
          lock: { mode: 'pessimistic_write' },
        })
      : await daysRepo.findOne({
          where: {
            userId,
            campaignId: campaign.id,
            rewardDay,
          },
        });

    if (!userDay) {
      const rules = await (manager
        ? manager.getRepository(WheelSegmentRule)
        : this.rulesRepo
      ).find({
        where: { campaignId: campaign.id, isActive: true },
        order: { sortOrder: 'ASC' },
      });
      const badges = await this.loadBadgeIds(
        manager ?? this.dataSource.manager,
        userId,
      );
      const layout = this.layout.buildLayout(rules, {
        rankLevel: 1,
        gemsAwardedToday: 0,
        xpAwardedToday: 0,
        ownedBadgeIds: badges,
        inventoryAvailable: new Map(),
      });

      userDay = await daysRepo.save(
        daysRepo.create({
          userId,
          campaignId: campaign.id,
          rewardDay,
          dayStartAt,
          dayEndAt,
          layoutSnapshot: layout,
          freeSpinsTotal: campaign.maxFreeSpinsPerDay,
          paidSpinsTotal: 0,
          extraSpinsTotal: 0,
          spinsUsed: 0,
          timezoneSnapshot: tz,
          layoutVersion: 1,
        }),
      );
      this.logger.log(
        `wheel_layout_created user=${userId} day=${rewardDay}`,
      );

      if (this.spinsAvailable(userDay) > 0) {
        void this.notifications.create({
          userId,
          type: NotificationType.LuckyWheelReady,
          title: 'Lucky Wheel is ready',
          body: 'Your free daily spin is waiting.',
          actionUrl: '/lucky-wheel',
          payload: { rewardDay },
        });
      }
    }

    return { campaign, userDay, profileTz: tz };
  }

  private rewardDayBounds(now: Date, timeZone: string) {
    const p = localParts(now, timeZone);
    let y = p.y;
    let m = p.m;
    let d = p.d;
    // Before 03:00 → previous calendar day is still active reward day
    if (p.hour < 3) {
      const prev = new Date(Date.UTC(y, m - 1, d - 1, 12));
      const pp = localParts(prev, timeZone);
      y = pp.y;
      m = pp.m;
      d = pp.d;
    }
    const rewardDay = toDateString(y, m, d);
    const dayStartAt = zonedTimeToUtc(y, m, d, 3, 0, timeZone);
    // next day 03:00
    const next = new Date(Date.UTC(y, m - 1, d + 1, 12));
    const np = localParts(next, timeZone);
    const dayEndAt = zonedTimeToUtc(np.y, np.m, np.d, 3, 0, timeZone);
    return { rewardDay, dayStartAt, dayEndAt };
  }

  private async getActiveCampaign(manager?: EntityManager) {
    const repo = manager
      ? manager.getRepository(WheelCampaign)
      : this.campaignsRepo;
    const campaign = await repo.findOne({
      where: { slug: WHEEL_DEFAULT_SLUG, status: WheelCampaignStatus.Active },
    });
    if (!campaign) {
      throw new AppException(
        AuthErrorCode.WHEEL_NOT_AVAILABLE,
        'Lucky Wheel campaign unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const now = Date.now();
    if (campaign.startsAt && campaign.startsAt.getTime() > now) {
      throw new AppException(
        AuthErrorCode.WHEEL_NOT_AVAILABLE,
        'Campaign not started',
      );
    }
    if (campaign.endsAt && campaign.endsAt.getTime() < now) {
      throw new AppException(
        AuthErrorCode.WHEEL_CAMPAIGN_ENDED,
        'Campaign ended',
      );
    }
    return campaign;
  }

  private async loadBadgeIds(manager: EntityManager, userId: string) {
    const rows = await manager.getRepository(UserBadge).find({
      where: { userId },
    });
    return new Set(rows.map((r) => r.badgeId));
  }

  private clientKind(rewardType: string): string {
    if (rewardType === WheelRewardType.LifetimeXp) return 'xp';
    if (rewardType === WheelRewardType.TryAgain) return 'try_again';
    if (rewardType === WheelRewardType.ExtraSpin) return 'try_again';
    return rewardType;
  }

  private async toSpinResponse(
    spin: WheelSpin,
    userId: string,
    userDay?: WheelUserDay,
    wallet?: {
      lifetimeXp: number;
      gems: number;
      coins: number;
      version: number;
    },
  ) {
    const day =
      userDay ??
      (await this.daysRepo.findOne({ where: { id: spin.userDayId } }));
    const w =
      wallet ??
      (await this.gamification.getWallet(userId));

    return {
      spinId: spin.id,
      winningSegmentId: spin.winningSegmentId,
      landingIndex: spin.landingIndex,
      reward: {
        type: this.clientKind(String(spin.rewardSnapshot?.type ?? '')),
        amount: Number(spin.rewardSnapshot?.amount ?? 0),
        label: String(spin.rewardSnapshot?.label ?? ''),
      },
      wallet: {
        coins: w.coins,
        gems: w.gems,
        lifetimeXp: w.lifetimeXp,
        version: w.version,
      },
      spinsAvailable: day ? this.spinsAvailable(day) : 0,
      resetsAt: day?.dayEndAt.toISOString() ?? null,
      layoutVersion: day?.layoutVersion ?? 1,
    };
  }

  async ensureDefaultCampaign() {
    let campaign = await this.campaignsRepo.findOne({
      where: { slug: WHEEL_DEFAULT_SLUG },
    });
    if (!campaign) {
      campaign = await this.campaignsRepo.save(
        this.campaignsRepo.create({
          slug: WHEEL_DEFAULT_SLUG,
          status: WheelCampaignStatus.Active,
          segmentCount: 6,
          maxFreeSpinsPerDay: 1,
          maxPaidRespinsPerDay: 1,
          respinGemPrice: WHEEL_RESPIN_GEM_PRICE,
        }),
      );
    } else if (campaign.status !== WheelCampaignStatus.Active) {
      campaign.status = WheelCampaignStatus.Active;
      await this.campaignsRepo.save(campaign);
    }

    for (const seed of DEFAULT_SEGMENT_SEED) {
      const existing = await this.rulesRepo.findOne({
        where: { campaignId: campaign.id, rewardKey: seed.rewardKey },
      });
      if (existing) continue;
      await this.rulesRepo.save(
        this.rulesRepo.create({
          campaignId: campaign.id,
          rewardKey: seed.rewardKey,
          rewardType: seed.rewardType as WheelRewardType,
          rewardPayload: {
            amount: seed.amount,
            label: seed.label,
            ...((seed as { payload?: Record<string, unknown> }).payload ?? {}),
          },
          weight: String(seed.weight),
          replacementRewardKey:
            'replacementRewardKey' in seed
              ? ((seed as { replacementRewardKey?: string }).replacementRewardKey ??
                null)
              : null,
          allowDuplicateOnLayout:
            'allowDuplicateOnLayout' in seed
              ? Boolean(
                  (seed as { allowDuplicateOnLayout?: boolean })
                    .allowDuplicateOnLayout,
                )
              : true,
          isActive: true,
          sortOrder: seed.sortOrder,
        }),
      );
    }
    this.logger.log('Lucky Wheel default campaign ready');
  }
}
