import type {
  RankGateRule,
  RankGateRules,
} from './entities/rank-definition.entity';

export type RankEvalContext = {
  lifetimeXp: number;
  activeDays: number;
  counters: Record<string, number>;
};

export type RankRequirementStatus = {
  key: string;
  current: number;
  required: number;
  complete: boolean;
};

function counterValue(
  counters: Record<string, number>,
  type: string,
  key?: string,
): number {
  if (type === 'role_recipe' && key) {
    return counters[`role_recipe:${key}`] ?? counters[key] ?? 0;
  }
  return counters[type] ?? 0;
}

export function evaluateRule(
  rule: RankGateRule,
  ctx: RankEvalContext,
): RankRequirementStatus {
  const required = rule.gte ?? 1;
  let current = 0;
  let key = rule.type;

  switch (rule.type) {
    case 'lifetime_xp':
      current = ctx.lifetimeXp;
      break;
    case 'active_days':
      current = ctx.activeDays;
      break;
    case 'role_recipe':
      key = rule.key ? `role_recipe:${rule.key}` : 'role_recipe';
      current = counterValue(ctx.counters, rule.type, rule.key);
      break;
    default:
      current = counterValue(ctx.counters, rule.type, rule.key);
      break;
  }

  return {
    key,
    current,
    required,
    complete: current >= required,
  };
}

export function evaluateGates(
  rules: RankGateRules | null | undefined,
  ctx: RankEvalContext,
): { allComplete: boolean; requirements: RankRequirementStatus[] } {
  const list = rules?.all ?? [];
  const requirements = list.map((r) => evaluateRule(r, ctx));
  return {
    allComplete: requirements.every((r) => r.complete),
    requirements,
  };
}

/** Merge xp/active day floors into gate list when seeds omit them. */
export function ensureBaseGates(
  rules: RankGateRules,
  xpThreshold: number,
  minimumActiveDays: number,
): RankGateRules {
  const all = [...(rules.all ?? [])];
  if (xpThreshold > 0 && !all.some((r) => r.type === 'lifetime_xp')) {
    all.unshift({ type: 'lifetime_xp', gte: xpThreshold });
  }
  if (
    minimumActiveDays > 0 &&
    !all.some((r) => r.type === 'active_days')
  ) {
    all.splice(1, 0, { type: 'active_days', gte: minimumActiveDays });
  }
  return { all };
}
