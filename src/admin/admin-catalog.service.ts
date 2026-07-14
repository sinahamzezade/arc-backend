import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadgeDefinition } from '../badges/entities/badge-definition.entity';
import {
  BadgeCategory,
  BadgeCriteriaType,
  BadgeDefinitionStatus,
  BadgeRarity,
  type BadgeCriteriaJson,
  type BadgeRewardJson,
} from '../badges/badge.constants';
import { ContentCatalogService } from '../content-pool/content-catalog.service';
import { ContentPublicationStatus } from '../content-pool/content-pool.constants';
import { CourseTemplate } from '../content-pool/entities/course-template.entity';
import { Dataset } from '../content-pool/entities/dataset.entity';
import { ModuleTemplate } from '../content-pool/entities/module-template.entity';
import { RewardCurrency } from '../gamification/entities/reward-ledger-entry.entity';
import {
  StoreItem,
  StoreItemType,
} from '../gamification/entities/store-item.entity';
import { WheelCampaign } from '../lucky-wheel/entities/wheel-campaign.entity';
import { WheelSegmentRule } from '../lucky-wheel/entities/wheel-segment-rule.entity';
import { QuestionnaireDefinition } from '../questionnaire/entities/questionnaire-definition.entity';
import { RankDefinition } from '../ranks/entities/rank-definition.entity';
import { QuestDefinition } from '../quests/entities/quest-definition.entity';
import {
  QuestCadence,
  QuestCategory,
  QuestConditionType,
  QuestDefinitionStatus,
  QUEST_XP_SOURCES,
  type QuestConditionJson,
  type QuestRewardJson,
} from '../quests/quest.constants';

@Injectable()
export class AdminCatalogService {
  constructor(
    @InjectRepository(RankDefinition)
    private readonly ranks: Repository<RankDefinition>,
    @InjectRepository(StoreItem)
    private readonly store: Repository<StoreItem>,
    @InjectRepository(BadgeDefinition)
    private readonly badges: Repository<BadgeDefinition>,
    @InjectRepository(QuestDefinition)
    private readonly quests: Repository<QuestDefinition>,
    @InjectRepository(WheelCampaign)
    private readonly wheels: Repository<WheelCampaign>,
    @InjectRepository(WheelSegmentRule)
    private readonly wheelRules: Repository<WheelSegmentRule>,
    @InjectRepository(CourseTemplate)
    private readonly courses: Repository<CourseTemplate>,
    @InjectRepository(ModuleTemplate)
    private readonly modules: Repository<ModuleTemplate>,
    @InjectRepository(QuestionnaireDefinition)
    private readonly questionnaires: Repository<QuestionnaireDefinition>,
    @InjectRepository(Dataset)
    private readonly datasets: Repository<Dataset>,
    private readonly contentCatalog: ContentCatalogService,
  ) {}

  listRanks() {
    return this.ranks.find({ order: { displayOrder: 'ASC', level: 'ASC' } });
  }

  async getRank(id: string) {
    const row = await this.ranks.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Rank not found');
    return row;
  }

  async createRank(data: {
    level: number;
    slug: string;
    title: string;
    xpThreshold: number;
    minimumActiveDays: number;
    displayOrder: number;
    isActive: boolean;
    iconAssetKey?: string | null;
  }) {
    const slug = data.slug.trim().toLowerCase();
    const title = data.title.trim();
    if (!slug || !title) {
      throw new BadRequestException('Slug and title are required');
    }
    if (!Number.isFinite(data.level) || data.level < 1) {
      throw new BadRequestException('Level must be a positive integer');
    }

    const levelTaken = await this.ranks.exists({
      where: { level: data.level },
    });
    if (levelTaken) {
      throw new BadRequestException(`Level ${data.level} already exists`);
    }
    const slugTaken = await this.ranks.exists({ where: { slug } });
    if (slugTaken) {
      throw new BadRequestException(`Slug "${slug}" already exists`);
    }

    const row = this.ranks.create({
      level: data.level,
      slug,
      title,
      xpThreshold: data.xpThreshold,
      minimumActiveDays: data.minimumActiveDays,
      displayOrder: data.displayOrder,
      isActive: data.isActive,
      iconAssetKey: data.iconAssetKey?.trim() || null,
      gateRules: { all: [] },
      rewardConfig: {},
      version: 1,
    });
    return this.ranks.save(row);
  }

  async updateRank(
    id: string,
    patch: Partial<
      Pick<
        RankDefinition,
        | 'level'
        | 'slug'
        | 'title'
        | 'xpThreshold'
        | 'minimumActiveDays'
        | 'displayOrder'
        | 'isActive'
        | 'iconAssetKey'
      >
    >,
  ) {
    const row = await this.getRank(id);

    if (patch.level !== undefined && patch.level !== row.level) {
      if (!Number.isFinite(patch.level) || patch.level < 1) {
        throw new BadRequestException('Level must be a positive integer');
      }
      const levelTaken = await this.ranks.exists({
        where: { level: patch.level },
      });
      if (levelTaken) {
        throw new BadRequestException(`Level ${patch.level} already exists`);
      }
    }

    if (patch.slug !== undefined) {
      const slug = patch.slug.trim().toLowerCase();
      if (!slug) throw new BadRequestException('Slug is required');
      if (slug !== row.slug) {
        const slugTaken = await this.ranks.exists({ where: { slug } });
        if (slugTaken) {
          throw new BadRequestException(`Slug "${slug}" already exists`);
        }
      }
      patch.slug = slug;
    }

    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new BadRequestException('Title is required');
      patch.title = title;
    }

    Object.assign(row, patch);
    row.version = (row.version ?? 1) + 1;
    return this.ranks.save(row);
  }

  async deleteRank(id: string) {
    const row = await this.getRank(id);
    await this.ranks.remove(row);
    return true;
  }

  listStoreItems() {
    return this.store.find({ order: { sku: 'ASC' } });
  }

  async getStoreItem(id: string) {
    const row = await this.store.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Store item not found');
    return row;
  }

  async createStoreItem(data: {
    sku: string;
    title: string;
    description: string;
    price: number;
    currency: RewardCurrency;
    itemType: StoreItemType;
    rarity: string;
    purchaseLimit: number | null;
    isActive: boolean;
  }) {
    const sku = data.sku.trim().toLowerCase();
    const title = data.title.trim();
    if (!sku || !title) {
      throw new BadRequestException('SKU and title are required');
    }
    if (!Number.isFinite(data.price) || data.price < 0) {
      throw new BadRequestException('Price must be a non-negative integer');
    }
    if (!Object.values(RewardCurrency).includes(data.currency)) {
      throw new BadRequestException('Invalid currency');
    }
    if (!Object.values(StoreItemType).includes(data.itemType)) {
      throw new BadRequestException('Invalid item type');
    }

    const skuTaken = await this.store.exists({ where: { sku } });
    if (skuTaken) {
      throw new BadRequestException(`SKU "${sku}" already exists`);
    }

    const row = this.store.create({
      sku,
      title,
      description: data.description ?? '',
      price: data.price,
      currency: data.currency,
      itemType: data.itemType,
      rarity: data.rarity.trim() || 'common',
      purchaseLimit: data.purchaseLimit,
      isActive: data.isActive,
      inventoryPayload: {},
      availabilityRules: {},
      version: 1,
    });
    return this.store.save(row);
  }

  async updateStoreItem(
    id: string,
    patch: Partial<
      Pick<
        StoreItem,
        | 'sku'
        | 'title'
        | 'description'
        | 'price'
        | 'currency'
        | 'itemType'
        | 'rarity'
        | 'purchaseLimit'
        | 'isActive'
      >
    >,
  ) {
    const row = await this.getStoreItem(id);

    if (patch.sku !== undefined) {
      const sku = patch.sku.trim().toLowerCase();
      if (!sku) throw new BadRequestException('SKU is required');
      if (sku !== row.sku) {
        const skuTaken = await this.store.exists({ where: { sku } });
        if (skuTaken) {
          throw new BadRequestException(`SKU "${sku}" already exists`);
        }
      }
      patch.sku = sku;
    }

    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new BadRequestException('Title is required');
      patch.title = title;
    }

    if (patch.price !== undefined) {
      if (!Number.isFinite(patch.price) || patch.price < 0) {
        throw new BadRequestException('Price must be a non-negative integer');
      }
    }

    if (
      patch.currency !== undefined &&
      !Object.values(RewardCurrency).includes(patch.currency)
    ) {
      throw new BadRequestException('Invalid currency');
    }

    if (
      patch.itemType !== undefined &&
      !Object.values(StoreItemType).includes(patch.itemType)
    ) {
      throw new BadRequestException('Invalid item type');
    }

    Object.assign(row, patch);
    row.version = (row.version ?? 1) + 1;
    return this.store.save(row);
  }

  async deleteStoreItem(id: string) {
    const row = await this.getStoreItem(id);
    await this.store.remove(row);
    return true;
  }

  listBadges() {
    return this.badges.find({ order: { sortOrder: 'ASC', code: 'ASC' } });
  }

  async getBadge(id: string) {
    const row = await this.badges.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Badge not found');
    return row;
  }

  async createBadge(data: {
    code: string;
    name: string;
    description: string;
    category: BadgeCategory;
    rarity: BadgeRarity;
    status: BadgeDefinitionStatus;
    criteriaType: BadgeCriteriaType;
    criteriaJson: BadgeCriteriaJson;
    rewardJson: BadgeRewardJson;
    sortOrder: number;
    isHidden: boolean;
    iconAssetKey?: string | null;
  }) {
    const code = data.code.trim().toLowerCase().replace(/\s+/g, '-');
    const name = data.name.trim();
    if (!code || !name) {
      throw new BadRequestException('Code and name are required');
    }
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(code)) {
      throw new BadRequestException(
        'Code must be lowercase letters, numbers, _ or -',
      );
    }
    this.assertBadgeEnums(data);
    this.assertCriteria(data.criteriaType, data.criteriaJson);

    const taken = await this.badges.exists({ where: { code } });
    if (taken) {
      throw new BadRequestException(`Code "${code}" already exists`);
    }

    const row = this.badges.create({
      code,
      version: 1,
      nameKey: `badge.${code}.name`,
      descriptionKey: `badge.${code}.description`,
      name,
      description: data.description.trim() || name,
      category: data.category,
      rarity: data.rarity,
      status: data.status,
      criteriaType: data.criteriaType,
      criteriaJson: data.criteriaJson,
      rewardJson: data.rewardJson ?? {},
      sortOrder: data.sortOrder,
      isHidden: data.isHidden,
      isSeasonal: false,
      iconAssetKey: data.iconAssetKey?.trim() || null,
    });
    return this.badges.save(row);
  }

  async updateBadge(
    id: string,
    patch: Partial<
      Pick<
        BadgeDefinition,
        | 'code'
        | 'name'
        | 'description'
        | 'category'
        | 'rarity'
        | 'status'
        | 'isHidden'
        | 'sortOrder'
        | 'iconAssetKey'
        | 'criteriaType'
        | 'criteriaJson'
        | 'rewardJson'
      >
    >,
  ) {
    const row = await this.getBadge(id);

    if (patch.code !== undefined) {
      const code = patch.code.trim().toLowerCase().replace(/\s+/g, '-');
      if (!code) throw new BadRequestException('Code is required');
      if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(code)) {
        throw new BadRequestException(
          'Code must be lowercase letters, numbers, _ or -',
        );
      }
      if (code !== row.code) {
        const taken = await this.badges.exists({ where: { code } });
        if (taken) {
          throw new BadRequestException(`Code "${code}" already exists`);
        }
        patch.code = code;
        row.nameKey = `badge.${code}.name`;
        row.descriptionKey = `badge.${code}.description`;
      } else {
        patch.code = code;
      }
    }

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new BadRequestException('Name is required');
      patch.name = name;
    }

    const nextType = patch.criteriaType ?? row.criteriaType;
    const nextCriteria = patch.criteriaJson ?? row.criteriaJson;
    if (patch.criteriaType !== undefined || patch.criteriaJson !== undefined) {
      if (
        patch.criteriaType !== undefined &&
        !Object.values(BadgeCriteriaType).includes(patch.criteriaType)
      ) {
        throw new BadRequestException('Invalid criteria type');
      }
      this.assertCriteria(nextType, nextCriteria);
    }

    if (patch.category !== undefined) {
      if (!Object.values(BadgeCategory).includes(patch.category)) {
        throw new BadRequestException('Invalid category');
      }
    }
    if (patch.rarity !== undefined) {
      if (!Object.values(BadgeRarity).includes(patch.rarity)) {
        throw new BadRequestException('Invalid rarity');
      }
    }
    if (patch.status !== undefined) {
      if (!Object.values(BadgeDefinitionStatus).includes(patch.status)) {
        throw new BadRequestException('Invalid status');
      }
    }

    Object.assign(row, patch);
    row.version = (row.version ?? 1) + 1;
    return this.badges.save(row);
  }

  async deleteBadge(id: string) {
    const row = await this.getBadge(id);
    await this.badges.remove(row);
    return true;
  }

  listQuests() {
    return this.quests.find({ order: { sortOrder: 'ASC', code: 'ASC' } });
  }

  async getQuest(id: string) {
    const row = await this.quests.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Quest not found');
    return row;
  }

  async createQuest(data: {
    code: string;
    name: string;
    description: string;
    detail: string;
    cadence: QuestCadence;
    category: QuestCategory;
    status: QuestDefinitionStatus;
    conditionType: QuestConditionType;
    conditionJson: QuestConditionJson;
    rewardJson: QuestRewardJson;
    sortOrder: number;
    isOptional: boolean;
    startsAt?: Date | null;
    endsAt?: Date | null;
  }) {
    const code = data.code.trim().toLowerCase().replace(/\s+/g, '-');
    const name = data.name.trim();
    if (!code || !name) {
      throw new BadRequestException('Code and name are required');
    }
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(code)) {
      throw new BadRequestException(
        'Code must be lowercase letters, numbers, _ or -',
      );
    }
    this.assertQuestEnums(data);
    this.assertQuestCondition(data.conditionType, data.conditionJson);

    const taken = await this.quests.exists({ where: { code } });
    if (taken) {
      throw new BadRequestException(`Code "${code}" already exists`);
    }

    const row = this.quests.create({
      code,
      name,
      description: data.description.trim() || name,
      detail: data.detail.trim(),
      cadence: data.cadence,
      category: data.category,
      status: data.status,
      conditionType: data.conditionType,
      conditionJson: data.conditionJson,
      rewardJson: data.rewardJson ?? {},
      sortOrder: data.sortOrder,
      isOptional: data.isOptional,
      startsAt: data.startsAt ?? null,
      endsAt: data.endsAt ?? null,
    });
    return this.quests.save(row);
  }

  async updateQuest(
    id: string,
    patch: Partial<
      Pick<
        QuestDefinition,
        | 'code'
        | 'name'
        | 'description'
        | 'detail'
        | 'cadence'
        | 'category'
        | 'status'
        | 'conditionType'
        | 'conditionJson'
        | 'rewardJson'
        | 'sortOrder'
        | 'isOptional'
        | 'startsAt'
        | 'endsAt'
      >
    >,
  ) {
    const row = await this.getQuest(id);

    if (patch.code !== undefined) {
      const code = patch.code.trim().toLowerCase().replace(/\s+/g, '-');
      if (!code) throw new BadRequestException('Code is required');
      if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(code)) {
        throw new BadRequestException(
          'Code must be lowercase letters, numbers, _ or -',
        );
      }
      if (code !== row.code) {
        const taken = await this.quests.exists({ where: { code } });
        if (taken) {
          throw new BadRequestException(`Code "${code}" already exists`);
        }
      }
      patch.code = code;
    }

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new BadRequestException('Name is required');
      patch.name = name;
    }

    const nextType = patch.conditionType ?? row.conditionType;
    const nextCondition = patch.conditionJson ?? row.conditionJson;
    if (patch.conditionType !== undefined || patch.conditionJson !== undefined) {
      if (
        patch.conditionType !== undefined &&
        !Object.values(QuestConditionType).includes(patch.conditionType)
      ) {
        throw new BadRequestException('Invalid condition type');
      }
      this.assertQuestCondition(nextType, nextCondition);
    }

    if (patch.cadence !== undefined) {
      if (!Object.values(QuestCadence).includes(patch.cadence)) {
        throw new BadRequestException('Invalid cadence');
      }
    }
    if (patch.category !== undefined) {
      if (!Object.values(QuestCategory).includes(patch.category)) {
        throw new BadRequestException('Invalid category');
      }
    }
    if (patch.status !== undefined) {
      if (!Object.values(QuestDefinitionStatus).includes(patch.status)) {
        throw new BadRequestException('Invalid status');
      }
    }

    Object.assign(row, patch);
    return this.quests.save(row);
  }

  async deleteQuest(id: string) {
    const row = await this.getQuest(id);
    await this.quests.remove(row);
    return true;
  }

  private assertQuestEnums(data: {
    cadence: QuestCadence;
    category: QuestCategory;
    status: QuestDefinitionStatus;
    conditionType: QuestConditionType;
  }) {
    if (!Object.values(QuestCadence).includes(data.cadence)) {
      throw new BadRequestException('Invalid cadence');
    }
    if (!Object.values(QuestCategory).includes(data.category)) {
      throw new BadRequestException('Invalid category');
    }
    if (!Object.values(QuestDefinitionStatus).includes(data.status)) {
      throw new BadRequestException('Invalid status');
    }
    if (!Object.values(QuestConditionType).includes(data.conditionType)) {
      throw new BadRequestException('Invalid condition type');
    }
  }

  private assertQuestCondition(
    type: QuestConditionType,
    json: QuestConditionJson,
  ) {
    switch (type) {
      case QuestConditionType.Counter:
        if (!json.counterKey?.trim()) {
          throw new BadRequestException('conditionJson.counterKey required');
        }
        if (!Number.isFinite(json.target) || (json.target ?? 0) < 1) {
          throw new BadRequestException('conditionJson.target must be >= 1');
        }
        break;
      case QuestConditionType.LeagueXp:
        if (!json.xpSource || !QUEST_XP_SOURCES.includes(json.xpSource)) {
          throw new BadRequestException(
            'conditionJson.xpSource must be lesson, battle, or any',
          );
        }
        if (!Number.isFinite(json.minXp) || (json.minXp ?? 0) < 1) {
          throw new BadRequestException('conditionJson.minXp must be >= 1');
        }
        if (
          json.unitXp !== undefined &&
          (!Number.isFinite(json.unitXp) || (json.unitXp ?? 0) < 1)
        ) {
          throw new BadRequestException('conditionJson.unitXp must be >= 1');
        }
        break;
      case QuestConditionType.ActiveDays:
        if (!Number.isFinite(json.minDays) || (json.minDays ?? 0) < 1) {
          throw new BadRequestException('conditionJson.minDays must be >= 1');
        }
        break;
      case QuestConditionType.EventOnce:
        if (!json.eventType?.trim()) {
          throw new BadRequestException('conditionJson.eventType required');
        }
        break;
      default:
        throw new BadRequestException('Invalid condition type');
    }
  }

  private assertBadgeEnums(data: {
    category: BadgeCategory;
    rarity: BadgeRarity;
    status: BadgeDefinitionStatus;
    criteriaType: BadgeCriteriaType;
  }) {
    if (!Object.values(BadgeCategory).includes(data.category)) {
      throw new BadRequestException('Invalid category');
    }
    if (!Object.values(BadgeRarity).includes(data.rarity)) {
      throw new BadRequestException('Invalid rarity');
    }
    if (!Object.values(BadgeDefinitionStatus).includes(data.status)) {
      throw new BadRequestException('Invalid status');
    }
    if (!Object.values(BadgeCriteriaType).includes(data.criteriaType)) {
      throw new BadRequestException('Invalid criteria type');
    }
  }

  private assertCriteria(
    type: BadgeCriteriaType,
    json: BadgeCriteriaJson,
  ) {
    switch (type) {
      case BadgeCriteriaType.Counter:
        if (!json.counterKey?.trim()) {
          throw new BadRequestException('criteriaJson.counterKey required');
        }
        if (!Number.isFinite(json.target) || (json.target ?? 0) < 1) {
          throw new BadRequestException('criteriaJson.target must be >= 1');
        }
        break;
      case BadgeCriteriaType.DistinctSet:
        if (!json.setKey?.trim()) {
          throw new BadRequestException('criteriaJson.setKey required');
        }
        if (!Number.isFinite(json.setTarget) || (json.setTarget ?? 0) < 1) {
          throw new BadRequestException('criteriaJson.setTarget must be >= 1');
        }
        break;
      case BadgeCriteriaType.Consecutive:
        if (!json.consecutiveKey?.trim()) {
          throw new BadRequestException('criteriaJson.consecutiveKey required');
        }
        if (
          !Number.isFinite(json.minConsecutive) ||
          (json.minConsecutive ?? 0) < 1
        ) {
          throw new BadRequestException(
            'criteriaJson.minConsecutive must be >= 1',
          );
        }
        break;
      case BadgeCriteriaType.EventOnce:
        if (!json.eventType?.trim()) {
          throw new BadRequestException('criteriaJson.eventType required');
        }
        break;
      case BadgeCriteriaType.ReferralMilestone:
        if (
          !Number.isFinite(json.referralQualified) ||
          (json.referralQualified ?? 0) < 1
        ) {
          throw new BadRequestException(
            'criteriaJson.referralQualified must be >= 1',
          );
        }
        break;
      case BadgeCriteriaType.Composite:
        // Deferred in evaluator — allow save but warn via accepted empty
        break;
      default:
        throw new BadRequestException('Invalid criteria type');
    }
  }

  listWheelCampaigns() {
    return this.wheels.find({ order: { createdAt: 'DESC' } });
  }

  async getWheelCampaign(id: string) {
    const row = await this.wheels.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Campaign not found');
    const segments = await this.wheelRules.find({
      where: { campaignId: id },
      order: { sortOrder: 'ASC', rewardKey: 'ASC' },
    });
    return { campaign: row, segments };
  }

  async updateWheelCampaign(
    id: string,
    patch: Partial<
      Pick<
        WheelCampaign,
        | 'status'
        | 'maxFreeSpinsPerDay'
        | 'maxPaidRespinsPerDay'
        | 'respinGemPrice'
        | 'segmentCount'
      >
    >,
  ) {
    const row = await this.wheels.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Campaign not found');
    Object.assign(row, patch);
    return this.wheels.save(row);
  }

  async updateWheelSegment(
    id: string,
    patch: Partial<Pick<WheelSegmentRule, 'weight' | 'isActive' | 'sortOrder'>>,
  ) {
    const row = await this.wheelRules.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Segment not found');
    Object.assign(row, patch);
    return this.wheelRules.save(row);
  }

  listCourses() {
    return this.courses.find({ order: { slug: 'ASC', version: 'DESC' } });
  }

  async getCourse(id: string) {
    const row = await this.courses.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Course not found');
    const modules = await this.modules.find({
      where: { courseTemplateId: id },
      order: { orderHint: 'ASC' },
    });
    return { course: row, modules };
  }

  async updateCourse(
    id: string,
    patch: {
      title?: string;
      learningOutcome?: string;
      isActive?: boolean;
      isRequired?: boolean;
      status?: ContentPublicationStatus;
    },
  ) {
    const row = await this.courses.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Course not found');
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.learningOutcome !== undefined)
      row.learningOutcome = patch.learningOutcome;
    if (patch.isActive !== undefined) row.isActive = patch.isActive;
    if (patch.isRequired !== undefined) row.isRequired = patch.isRequired;
    if (patch.status !== undefined) row.status = patch.status;
    return this.courses.save(row);
  }

  listQuestionnaires() {
    return this.questionnaires.find({
      relations: { steps: true },
      order: { version: 'DESC' },
    });
  }

  async getQuestionnaire(id: string) {
    const row = await this.questionnaires.findOne({
      where: { id },
      relations: { steps: { options: true } },
    });
    if (!row) throw new NotFoundException('Questionnaire not found');
    row.steps = (row.steps ?? []).sort((a, b) => a.stepNumber - b.stepNumber);
    return row;
  }

  async activateQuestionnaire(id: string) {
    const row = await this.getQuestionnaire(id);
    await this.questionnaires
      .createQueryBuilder()
      .update(QuestionnaireDefinition)
      .set({ isActive: false })
      .execute();
    row.isActive = true;
    return this.questionnaires.save(row);
  }

  createCourse(input: {
    slug: string;
    title: string;
    learningOutcome?: string;
    actorId?: string;
  }) {
    return this.contentCatalog.createCourse(
      {
        slug: input.slug,
        title: input.title,
        learningOutcome: input.learningOutcome ?? '',
      },
      input.actorId,
    );
  }

  createModule(input: {
    courseTemplateId: string;
    slug: string;
    title: string;
    orderHint?: number;
    estimatedMinutes?: number;
    actorId?: string;
  }) {
    return this.contentCatalog.createModule(
      {
        courseTemplateId: input.courseTemplateId,
        slug: input.slug,
        title: input.title,
        orderHint: input.orderHint,
        estimatedMinutes: input.estimatedMinutes,
      },
      input.actorId,
    );
  }

  listDatasets() {
    return this.datasets.find({ order: { slug: 'ASC' } });
  }

  createDataset(input: {
    slug: string;
    title: string;
    storageKey: string;
    checksum: string;
    format?: string;
    actorId?: string;
  }) {
    return this.contentCatalog.createDataset(
      {
        slug: input.slug,
        title: input.title,
        storageKey: input.storageKey,
        checksum: input.checksum,
        format: input.format,
      },
      input.actorId,
    );
  }
}
