import {
  QuestCadence,
  QuestCategory,
  QuestConditionType,
  type QuestConditionJson,
  type QuestRewardJson,
} from './quest.constants';

export type QuestCatalogSeedRow = {
  code: string;
  name: string;
  description: string;
  detail: string;
  cadence: QuestCadence;
  category: QuestCategory;
  conditionType: QuestConditionType;
  conditionJson: QuestConditionJson;
  rewardJson: QuestRewardJson;
  sortOrder: number;
  isOptional: boolean;
};

/** Default weekly league quests (was hardcoded in arc-app map-league). */
export const QUEST_CATALOG_SEED: QuestCatalogSeedRow[] = [
  {
    code: 'three-lessons',
    name: 'Three lessons',
    description: 'Complete lesson League XP this week',
    detail: 'Earn League XP from any 3 lessons this week',
    cadence: QuestCadence.Weekly,
    category: QuestCategory.League,
    conditionType: QuestConditionType.LeagueXp,
    conditionJson: {
      xpSource: 'lesson',
      minXp: 60,
      unitXp: 20,
    },
    rewardJson: { leagueXp: 40 },
    sortOrder: 10,
    isOptional: false,
  },
  {
    code: 'battle-once',
    name: 'Battle once',
    description: 'Finish one friend Battle',
    detail: 'Finish 1 friend Battle (capped League XP)',
    cadence: QuestCadence.Weekly,
    category: QuestCategory.League,
    conditionType: QuestConditionType.LeagueXp,
    conditionJson: {
      xpSource: 'battle',
      minXp: 1,
    },
    rewardJson: { leagueXp: 25 },
    sortOrder: 20,
    isOptional: false,
  },
  {
    code: 'weekly-commit',
    name: 'Weekly commit',
    description: 'Learn on distinct days this season',
    detail: 'Learn on 5 distinct days this season',
    cadence: QuestCadence.Weekly,
    category: QuestCategory.League,
    conditionType: QuestConditionType.ActiveDays,
    conditionJson: {
      minDays: 5,
    },
    rewardJson: { leagueXp: 50 },
    sortOrder: 30,
    isOptional: false,
  },
];
