import { createHash } from 'crypto';

export type TieBreakCandidate = {
  userId: string;
  qualifiedXp: number;
  proofWeightedXp: number;
  activeDays: number;
  /** Earlier time reaching final XP wins */
  finalXpReachedAt: Date | null;
};

/**
 * Sort descending by league XP, then proof XP, then active days,
 * then earlier final-XP timestamp, then stable UUID hash.
 */
export function compareTieBreak(
  a: TieBreakCandidate,
  b: TieBreakCandidate,
): number {
  if (b.qualifiedXp !== a.qualifiedXp) return b.qualifiedXp - a.qualifiedXp;
  if (b.proofWeightedXp !== a.proofWeightedXp) {
    return b.proofWeightedXp - a.proofWeightedXp;
  }
  if (b.activeDays !== a.activeDays) return b.activeDays - a.activeDays;

  const aTime = a.finalXpReachedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const bTime = b.finalXpReachedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (aTime !== bTime) return aTime - bTime;

  const aHash = stableUserHash(a.userId);
  const bHash = stableUserHash(b.userId);
  return aHash < bHash ? -1 : aHash > bHash ? 1 : 0;
}

export function rankByTieBreak<T extends TieBreakCandidate>(
  members: T[],
): Array<T & { position: number }> {
  const sorted = [...members].sort(compareTieBreak);
  return sorted.map((m, i) => ({ ...m, position: i + 1 }));
}

export function stableUserHash(userId: string): string {
  return createHash('sha256').update(userId).digest('hex');
}

export function tieBreakSnapshot(c: TieBreakCandidate) {
  return {
    qualifiedXp: c.qualifiedXp,
    proofWeightedXp: c.proofWeightedXp,
    activeDays: c.activeDays,
    finalXpReachedAt: c.finalXpReachedAt?.toISOString() ?? null,
    userHash: stableUserHash(c.userId).slice(0, 12),
  };
}
