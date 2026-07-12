import type {
  RankGateRules,
  RankRewardConfig,
} from './entities/rank-definition.entity';

export type RankSeed = {
  level: number;
  slug: string;
  title: string;
  xpThreshold: number;
  minimumActiveDays: number;
  gateRules: RankGateRules;
  rewardConfig: RankRewardConfig;
  iconAssetKey: string;
};

/** Doc §2 + §8 — 12 lifetime ranks. */
export const RANK_SEEDS: RankSeed[] = [
  {
    level: 1,
    slug: 'curious-egg',
    title: 'Curious Egg',
    xpThreshold: 0,
    minimumActiveDays: 0,
    gateRules: { all: [] },
    rewardConfig: {},
    iconAssetKey: 'rank-curious-egg',
  },
  {
    level: 2,
    slug: 'brave-hatchling',
    title: 'Brave Hatchling',
    xpThreshold: 300,
    minimumActiveDays: 2,
    gateRules: {
      all: [
        { type: 'lifetime_xp', gte: 300 },
        { type: 'active_days', gte: 2 },
        { type: 'lessons_completed', gte: 3 },
      ],
    },
    rewardConfig: { coins: 100 },
    iconAssetKey: 'rank-brave-hatchling',
  },
  {
    level: 3,
    slug: 'rookie-eagle',
    title: 'Rookie Eagle',
    xpThreshold: 1000,
    minimumActiveDays: 5,
    gateRules: {
      all: [
        { type: 'lifetime_xp', gte: 1000 },
        { type: 'active_days', gte: 5 },
        { type: 'quests_completed', gte: 1 },
        { type: 'assessments_passed', gte: 1 },
      ],
    },
    rewardConfig: {
      coins: 150,
      badgeId: 'rank-rookie-eagle',
      badgeLabel: 'Rookie Eagle',
    },
    iconAssetKey: 'rank-rookie-eagle',
  },
  {
    level: 4,
    slug: 'data-scout',
    title: 'Data Scout',
    xpThreshold: 2500,
    minimumActiveDays: 10,
    gateRules: {
      all: [
        { type: 'lifetime_xp', gte: 2500 },
        { type: 'active_days', gte: 10 },
        { type: 'assessments_passed', gte: 1 },
      ],
    },
    rewardConfig: { gems: 10 },
    iconAssetKey: 'rank-data-scout',
  },
  {
    level: 5,
    slug: 'semi-ninja',
    title: 'Semi Ninja',
    xpThreshold: 5000,
    minimumActiveDays: 21,
    gateRules: {
      all: [
        { type: 'lifetime_xp', gte: 5000 },
        { type: 'active_days', gte: 21 },
        { type: 'phases_completed', gte: 1 },
        { type: 'weekly_seals', gte: 3 },
      ],
    },
    rewardConfig: {
      frameSku: 'frame-semi-ninja',
      frameLabel: 'Semi Ninja Frame',
    },
    iconAssetKey: 'rank-semi-ninja',
  },
  {
    level: 6,
    slug: 'full-ninja',
    title: 'Full Ninja',
    xpThreshold: 8500,
    minimumActiveDays: 35,
    gateRules: {
      all: [
        { type: 'lifetime_xp', gte: 8500 },
        { type: 'active_days', gte: 35 },
        { type: 'phases_completed', gte: 2 },
        { type: 'challenges_passed', gte: 2 },
      ],
    },
    rewardConfig: { coins: 300 },
    iconAssetKey: 'rank-full-ninja',
  },
  {
    level: 7,
    slug: 'query-warrior',
    title: 'Query Warrior',
    xpThreshold: 13000,
    minimumActiveDays: 49,
    gateRules: {
      all: [
        { type: 'lifetime_xp', gte: 13000 },
        { type: 'active_days', gte: 49 },
        { type: 'role_recipe', key: 'track_specialist_challenge', gte: 1 },
      ],
    },
    rewardConfig: {
      badgeId: 'rank-query-warrior',
      badgeLabel: 'Specialist Badge',
    },
    iconAssetKey: 'rank-query-warrior',
  },
  {
    level: 8,
    slug: 'chart-wizard',
    title: 'Chart Wizard',
    xpThreshold: 19000,
    minimumActiveDays: 70,
    gateRules: {
      all: [
        { type: 'lifetime_xp', gte: 19000 },
        { type: 'active_days', gte: 70 },
        { type: 'role_recipe', key: 'applied_viz_task', gte: 1 },
      ],
    },
    rewardConfig: { gems: 20 },
    iconAssetKey: 'rank-chart-wizard',
  },
  {
    level: 9,
    slug: 'insight-hunter',
    title: 'Insight Hunter',
    xpThreshold: 27000,
    minimumActiveDays: 98,
    gateRules: {
      all: [
        { type: 'lifetime_xp', gte: 27000 },
        { type: 'active_days', gte: 98 },
        { type: 'projects_completed', gte: 2 },
        { type: 'boss_challenges_passed', gte: 2 },
      ],
    },
    rewardConfig: { coins: 200 },
    iconAssetKey: 'rank-insight-hunter',
  },
  {
    level: 10,
    slug: 'portfolio-hero',
    title: 'Portfolio Hero',
    xpThreshold: 38000,
    minimumActiveDays: 126,
    gateRules: {
      all: [
        { type: 'lifetime_xp', gte: 38000 },
        { type: 'active_days', gte: 126 },
        { type: 'portfolio_capstone_completed', gte: 1 },
      ],
    },
    rewardConfig: {
      frameSku: 'frame-portfolio-hero',
      frameLabel: 'Portfolio Hero Frame',
    },
    iconAssetKey: 'rank-portfolio-hero',
  },
  {
    level: 11,
    slug: 'interview-ranger',
    title: 'Interview Ranger',
    xpThreshold: 52000,
    minimumActiveDays: 160,
    gateRules: {
      all: [
        { type: 'lifetime_xp', gte: 52000 },
        { type: 'active_days', gte: 160 },
        { type: 'interview_readiness', gte: 1 },
      ],
    },
    rewardConfig: { coins: 500, gems: 25 },
    iconAssetKey: 'rank-interview-ranger',
  },
  {
    level: 12,
    slug: 'job-ready-eagle',
    title: 'Job-Ready Eagle',
    xpThreshold: 70000,
    minimumActiveDays: 180,
    gateRules: {
      all: [
        { type: 'lifetime_xp', gte: 70000 },
        { type: 'active_days', gte: 180 },
        { type: 'phases_completed', gte: 4 },
        { type: 'portfolio_capstone_completed', gte: 1 },
        { type: 'interview_readiness', gte: 1 },
      ],
    },
    rewardConfig: {
      frameSku: 'frame-job-ready-eagle',
      frameLabel: 'Job-Ready Eagle Frame',
      badgeId: 'rank-job-ready-eagle',
      badgeLabel: 'Job-Ready Eagle',
    },
    iconAssetKey: 'rank-job-ready-eagle',
  },
];

export const OUTBOX_RANK_UNLOCKED = 'rank.unlocked.v1';
