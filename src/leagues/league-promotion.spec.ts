import {
  applyPromotionResults,
  promotionCounts,
  zoneForPosition,
} from './league-promotion';
import { LeagueDivision, LeaguePromotionResult, LeagueTier } from './entities/league.enums';
import {
  clampPlacementToGate,
  demoteOne,
  meetsTierGate,
  promoteOne,
} from './league-tiers';
import { compareTieBreak, rankByTieBreak } from './league-tiebreak';
import {
  regionalBucketForTimezone,
  seasonBoundsForTimezone,
} from './league-season-bounds';
import { LeagueRegionalBucket } from './entities/league.enums';

describe('league-tiers', () => {
  it('enforces Master seal gate', () => {
    expect(meetsTierGate(LeagueTier.Master, 10, 11)).toBe(false);
    expect(meetsTierGate(LeagueTier.Master, 10, 12)).toBe(true);
    expect(meetsTierGate(LeagueTier.Diamond, 8, 0)).toBe(true);
  });

  it('promotes division then tier', () => {
    expect(promoteOne({ tier: LeagueTier.Bronze, division: LeagueDivision.III }))
      .toEqual({ tier: LeagueTier.Bronze, division: LeagueDivision.II });
    expect(promoteOne({ tier: LeagueTier.Gold, division: LeagueDivision.I }))
      .toEqual({ tier: LeagueTier.Platinum, division: LeagueDivision.III });
  });

  it('demotes across tier floor to prior I', () => {
    expect(demoteOne({ tier: LeagueTier.Silver, division: LeagueDivision.III }))
      .toEqual({ tier: LeagueTier.Bronze, division: LeagueDivision.I });
  });

  it('clamps gate-blocked promotion', () => {
    const gated = clampPlacementToGate(
      { tier: LeagueTier.Platinum, division: LeagueDivision.III },
      4, // Gold gate only
      0,
    );
    expect(gated.gateBlocked).toBe(true);
    expect(gated.placement).toEqual({
      tier: LeagueTier.Gold,
      division: LeagueDivision.I,
    });
  });
});

describe('league-promotion', () => {
  it('uses 7/5 split for full 30 cohort', () => {
    const counts = promotionCounts(30);
    expect(counts.promoteCount).toBe(7);
    expect(counts.demoteCount).toBe(5);
    expect(counts.remainFloor).toBe(8);
    expect(counts.remainCeil).toBe(25);
  });

  it('scales small cohorts', () => {
    const counts = promotionCounts(10);
    expect(counts.promoteCount).toBe(Math.max(1, Math.floor(10 * 0.23)));
    expect(counts.demoteCount).toBe(Math.max(1, Math.floor(10 * 0.17)));
  });

  it('marks zero-XP Bronze inactive', () => {
    const outcomes = applyPromotionResults([
      {
        userId: 'a',
        position: 1,
        qualifiedXp: 100,
        placement: { tier: LeagueTier.Bronze, division: LeagueDivision.I },
        rankLevel: 1,
        weeklySeals: 0,
        isBronzeFloor: true,
      },
      {
        userId: 'b',
        position: 2,
        qualifiedXp: 0,
        placement: { tier: LeagueTier.Bronze, division: LeagueDivision.III },
        rankLevel: 1,
        weeklySeals: 0,
        isBronzeFloor: true,
      },
    ]);
    const inactive = outcomes.find((o) => o.userId === 'b');
    expect(inactive?.result).toBe(LeaguePromotionResult.Inactive);
  });

  it('gate-blocks Gold I winner lacking Platinum rank', () => {
    const outcomes = applyPromotionResults([
      {
        userId: 'winner',
        position: 1,
        qualifiedXp: 500,
        placement: { tier: LeagueTier.Gold, division: LeagueDivision.I },
        rankLevel: 4,
        weeklySeals: 0,
        isBronzeFloor: false,
      },
      {
        userId: 'other',
        position: 2,
        qualifiedXp: 10,
        placement: { tier: LeagueTier.Gold, division: LeagueDivision.I },
        rankLevel: 4,
        weeklySeals: 0,
        isBronzeFloor: false,
      },
    ]);
    const winner = outcomes.find((o) => o.userId === 'winner')!;
    expect(winner.result).toBe(LeaguePromotionResult.GateBlocked);
    expect(winner.newPlacement).toEqual({
      tier: LeagueTier.Gold,
      division: LeagueDivision.I,
    });
  });

  it('maps zones', () => {
    expect(zoneForPosition(1, 30)).toBe('promote');
    expect(zoneForPosition(15, 30)).toBe('remain');
    expect(zoneForPosition(28, 30)).toBe('demote');
  });
});

describe('league-tiebreak', () => {
  it('orders by XP then proof then days then time then hash', () => {
    const ranked = rankByTieBreak([
      {
        userId: '00000000-0000-0000-0000-000000000002',
        qualifiedXp: 100,
        proofWeightedXp: 10,
        activeDays: 3,
        finalXpReachedAt: new Date('2026-07-10T12:00:00Z'),
      },
      {
        userId: '00000000-0000-0000-0000-000000000001',
        qualifiedXp: 100,
        proofWeightedXp: 20,
        activeDays: 2,
        finalXpReachedAt: new Date('2026-07-10T12:00:00Z'),
      },
      {
        userId: '00000000-0000-0000-0000-000000000003',
        qualifiedXp: 90,
        proofWeightedXp: 50,
        activeDays: 5,
        finalXpReachedAt: new Date('2026-07-01T12:00:00Z'),
      },
    ]);
    expect(ranked.map((r) => r.userId)).toEqual([
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000003',
    ]);
    expect(ranked.map((r) => r.position)).toEqual([1, 2, 3]);
  });

  it('earlier final XP time wins on full tie of XP metrics', () => {
    const a = {
      userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      qualifiedXp: 50,
      proofWeightedXp: 0,
      activeDays: 1,
      finalXpReachedAt: new Date('2026-07-10T10:00:00Z'),
    };
    const b = {
      userId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      qualifiedXp: 50,
      proofWeightedXp: 0,
      activeDays: 1,
      finalXpReachedAt: new Date('2026-07-10T11:00:00Z'),
    };
    expect(compareTieBreak(a, b)).toBeLessThan(0);
  });
});

describe('league-season-bounds', () => {
  it('maps timezone to regional bucket', () => {
    expect(regionalBucketForTimezone('Europe/Berlin')).toBe(
      LeagueRegionalBucket.Europe,
    );
    expect(regionalBucketForTimezone('America/New_York')).toBe(
      LeagueRegionalBucket.Americas,
    );
    expect(regionalBucketForTimezone('Asia/Tokyo')).toBe(
      LeagueRegionalBucket.Apac,
    );
    expect(regionalBucketForTimezone('Asia/Tehran')).toBe(
      LeagueRegionalBucket.MiddleEastAfrica,
    );
  });

  it('produces Monday 04:00 → next Monday window', () => {
    // Wednesday mid-week Europe
    const now = new Date('2026-07-08T12:00:00Z');
    const { startsAt, endsAt } = seasonBoundsForTimezone(
      now,
      'Europe/Berlin',
    );
    expect(startsAt.getTime()).toBeLessThan(now.getTime());
    expect(endsAt.getTime()).toBeGreaterThan(now.getTime());
    // ~7 days
    const length = endsAt.getTime() - startsAt.getTime();
    expect(length).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(length).toBeLessThan(8 * 24 * 60 * 60 * 1000);
  });
});
