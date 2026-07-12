import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BADGE_CATALOG_SEED } from './badge-catalog.seed';
import {
  BadgeDefinitionStatus,
} from './badge.constants';
import { BadgeDefinition } from './entities/badge-definition.entity';

@Injectable()
export class BadgesCatalogSeedService implements OnModuleInit {
  private readonly logger = new Logger(BadgesCatalogSeedService.name);

  constructor(
    @InjectRepository(BadgeDefinition)
    private readonly defsRepo: Repository<BadgeDefinition>,
  ) {}

  async onModuleInit() {
    await this.ensureCatalog();
  }

  async ensureCatalog() {
    for (const seed of BADGE_CATALOG_SEED) {
      const existing = await this.defsRepo.findOne({
        where: { code: seed.code },
      });
      if (existing) {
        if (existing.status === BadgeDefinitionStatus.Active) continue;
        continue;
      }
      await this.defsRepo.save(
        this.defsRepo.create({
          code: seed.code,
          version: 1,
          nameKey: `badge.${seed.code}.name`,
          descriptionKey: `badge.${seed.code}.description`,
          name: seed.name,
          description: seed.description,
          category: seed.category,
          rarity: seed.rarity,
          iconAssetKey: seed.iconAssetKey,
          isHidden: false,
          isSeasonal: false,
          status: BadgeDefinitionStatus.Active,
          criteriaType: seed.criteriaType,
          criteriaJson: seed.criteriaJson,
          rewardJson: seed.rewardJson,
          sortOrder: seed.sortOrder,
        }),
      );
    }
    this.logger.log(`Badge catalog ensured (${BADGE_CATALOG_SEED.length} core)`);
  }
}
