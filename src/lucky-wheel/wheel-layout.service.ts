import { Injectable } from '@nestjs/common';
import {
  SEGMENT_COLORS,
  WHEEL_DAILY_GEMS_CAP,
  WHEEL_DAILY_XP_CAP,
  WHEEL_FALLBACK_REWARD_KEY,
  WHEEL_SEGMENT_COUNT,
} from './wheel.constants';
import { WheelSegmentRule } from './entities/wheel-segment-rule.entity';
import { WheelRewardType } from './entities/wheel.enums';
import type { LayoutSegmentSnapshot } from './entities/wheel-user-day.entity';

export type LayoutContext = {
  rankLevel: number;
  gemsAwardedToday: number;
  xpAwardedToday: number;
  ownedBadgeIds: Set<string>;
  inventoryAvailable: Map<string, number>;
};

@Injectable()
export class WheelLayoutService {
  buildLayout(
    rules: WheelSegmentRule[],
    ctx: LayoutContext,
  ): LayoutSegmentSnapshot[] {
    const candidates = rules
      .filter((r) => r.isActive)
      .filter((r) => this.isEligible(r, ctx))
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const byKey = new Map(candidates.map((c) => [c.rewardKey, c]));
    const picked: WheelSegmentRule[] = [];
    const typeCount = new Map<string, number>();

    // Prefer seeded order first (sort_order), fill to 6
    for (const rule of candidates) {
      if (picked.length >= WHEEL_SEGMENT_COUNT) break;
      if (!rule.allowDuplicateOnLayout) {
        if (picked.some((p) => p.rewardKey === rule.rewardKey)) continue;
      }
      const tc = typeCount.get(rule.rewardType) ?? 0;
      if (tc >= 2 && rule.rewardType !== WheelRewardType.Coins) continue;
      picked.push(rule);
      typeCount.set(rule.rewardType, tc + 1);
    }

    // Ensure at least one coin segment
    if (!picked.some((p) => p.rewardType === WheelRewardType.Coins)) {
      const coin =
        byKey.get(WHEEL_FALLBACK_REWARD_KEY) ??
        candidates.find((c) => c.rewardType === WheelRewardType.Coins);
      if (coin) {
        if (picked.length >= WHEEL_SEGMENT_COUNT) picked.pop();
        picked.push(coin);
      }
    }

    while (picked.length < WHEEL_SEGMENT_COUNT) {
      const fallback =
        byKey.get(WHEEL_FALLBACK_REWARD_KEY) ??
        candidates[0];
      if (!fallback) break;
      picked.push(fallback);
    }

    if (picked.length < WHEEL_SEGMENT_COUNT) {
      throw new Error('WHEEL_LAYOUT_INVALID');
    }

    return picked.slice(0, WHEEL_SEGMENT_COUNT).map((rule, i) => {
      const amount = Number(rule.rewardPayload?.amount ?? 0);
      const label =
        (rule.rewardPayload?.label as string) ||
        this.defaultLabel(rule.rewardType, amount);
      return {
        id: `segment-${String.fromCharCode(97 + i)}`,
        rewardKey: rule.rewardKey,
        rewardType: rule.rewardType,
        label,
        amount,
        weight: Number(rule.weight),
        color: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
        payload: { ...rule.rewardPayload },
        fallbackRewardKey: rule.replacementRewardKey ?? WHEEL_FALLBACK_REWARD_KEY,
      };
    });
  }

  replaceSegment(
    layout: LayoutSegmentSnapshot[],
    segmentId: string,
    rules: WheelSegmentRule[],
    ctx: LayoutContext,
    reason: string,
  ): { layout: LayoutSegmentSnapshot[]; reason: string } {
    const idx = layout.findIndex((s) => s.id === segmentId);
    if (idx < 0) return { layout, reason };

    const old = layout[idx];
    const byKey = new Map(rules.map((r) => [r.rewardKey, r]));
    const replacementKey =
      old.fallbackRewardKey ?? WHEEL_FALLBACK_REWARD_KEY;
    let rule = byKey.get(replacementKey);
    if (!rule || !this.isEligible(rule, ctx)) {
      rule = byKey.get(WHEEL_FALLBACK_REWARD_KEY) ?? rules.find((r) => r.isActive);
    }
    if (!rule) return { layout, reason };

    const amount = Number(rule.rewardPayload?.amount ?? 0);
    const next = [...layout];
    next[idx] = {
      id: old.id,
      rewardKey: rule.rewardKey,
      rewardType: rule.rewardType,
      label:
        (rule.rewardPayload?.label as string) ||
        this.defaultLabel(rule.rewardType, amount),
      amount,
      weight: Number(rule.weight),
      color: old.color,
      payload: { ...rule.rewardPayload },
      fallbackRewardKey: rule.replacementRewardKey ?? WHEEL_FALLBACK_REWARD_KEY,
    };
    return { layout: next, reason };
  }

  private isEligible(rule: WheelSegmentRule, ctx: LayoutContext): boolean {
    if (
      rule.minRankLevel != null &&
      ctx.rankLevel < rule.minRankLevel
    ) {
      return false;
    }
    if (
      rule.maxRankLevel != null &&
      ctx.rankLevel > rule.maxRankLevel
    ) {
      return false;
    }
    if (rule.rewardType === WheelRewardType.Gems) {
      const amt = Number(rule.rewardPayload?.amount ?? 0);
      if (ctx.gemsAwardedToday + amt > WHEEL_DAILY_GEMS_CAP) return false;
    }
    if (rule.rewardType === WheelRewardType.LifetimeXp) {
      const amt = Number(rule.rewardPayload?.amount ?? 0);
      if (ctx.xpAwardedToday + amt > WHEEL_DAILY_XP_CAP) return false;
    }
    if (rule.rewardType === WheelRewardType.Badge) {
      const badgeId = String(rule.rewardPayload?.badgeId ?? rule.rewardKey);
      if (ctx.ownedBadgeIds.has(badgeId)) return false;
    }
    if (rule.totalInventory != null) {
      const avail = ctx.inventoryAvailable.get(rule.rewardKey);
      if (avail != null && avail <= 0) return false;
    }
    return true;
  }

  private defaultLabel(type: WheelRewardType, amount: number): string {
    switch (type) {
      case WheelRewardType.Coins:
        return `${amount} Coins`;
      case WheelRewardType.Gems:
        return `${amount} Gems`;
      case WheelRewardType.LifetimeXp:
        return `${amount} XP`;
      case WheelRewardType.TryAgain:
        return 'Try Again';
      case WheelRewardType.ExtraSpin:
        return 'Extra Spin';
      case WheelRewardType.Badge:
        return 'Lucky Badge';
      case WheelRewardType.StreakFreeze:
        return 'Streak Freeze';
      default:
        return 'Reward';
    }
  }
}
