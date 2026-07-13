import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadgeDefinition } from '../badges/entities/badge-definition.entity';
import { ContentCatalogService } from '../content-pool/content-catalog.service';
import { ContentPublicationStatus } from '../content-pool/content-pool.constants';
import { CourseTemplate } from '../content-pool/entities/course-template.entity';
import { Dataset } from '../content-pool/entities/dataset.entity';
import { ModuleTemplate } from '../content-pool/entities/module-template.entity';
import { StoreItem } from '../gamification/entities/store-item.entity';
import { WheelCampaign } from '../lucky-wheel/entities/wheel-campaign.entity';
import { WheelSegmentRule } from '../lucky-wheel/entities/wheel-segment-rule.entity';
import { QuestionnaireDefinition } from '../questionnaire/entities/questionnaire-definition.entity';
import { RankDefinition } from '../ranks/entities/rank-definition.entity';

@Injectable()
export class AdminCatalogService {
  constructor(
    @InjectRepository(RankDefinition)
    private readonly ranks: Repository<RankDefinition>,
    @InjectRepository(StoreItem)
    private readonly store: Repository<StoreItem>,
    @InjectRepository(BadgeDefinition)
    private readonly badges: Repository<BadgeDefinition>,
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

  async updateRank(
    id: string,
    patch: Partial<
      Pick<
        RankDefinition,
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
    Object.assign(row, patch);
    return this.ranks.save(row);
  }

  listStoreItems() {
    return this.store.find({ order: { sku: 'ASC' } });
  }

  async getStoreItem(id: string) {
    const row = await this.store.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Store item not found');
    return row;
  }

  async updateStoreItem(
    id: string,
    patch: Partial<
      Pick<
        StoreItem,
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
    Object.assign(row, patch);
    return this.store.save(row);
  }

  listBadges() {
    return this.badges.find({ order: { sortOrder: 'ASC', code: 'ASC' } });
  }

  async getBadge(id: string) {
    const row = await this.badges.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Badge not found');
    return row;
  }

  async updateBadge(
    id: string,
    patch: Partial<
      Pick<
        BadgeDefinition,
        | 'name'
        | 'description'
        | 'category'
        | 'rarity'
        | 'status'
        | 'isHidden'
        | 'sortOrder'
        | 'iconAssetKey'
      >
    >,
  ) {
    const row = await this.getBadge(id);
    Object.assign(row, patch);
    return this.badges.save(row);
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
