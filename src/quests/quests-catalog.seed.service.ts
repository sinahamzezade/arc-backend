import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QuestDefinition } from './entities/quest-definition.entity';
import { QUEST_CATALOG_SEED } from './quest-catalog.seed';
import { QuestDefinitionStatus } from './quest.constants';

@Injectable()
export class QuestsCatalogSeedService implements OnModuleInit {
  private readonly logger = new Logger(QuestsCatalogSeedService.name);

  constructor(
    @InjectRepository(QuestDefinition)
    private readonly defsRepo: Repository<QuestDefinition>,
  ) {}

  async onModuleInit() {
    await this.ensureCatalog();
  }

  async ensureCatalog() {
    for (const seed of QUEST_CATALOG_SEED) {
      const existing = await this.defsRepo.findOne({
        where: { code: seed.code },
      });
      if (existing) continue;

      await this.defsRepo.save(
        this.defsRepo.create({
          code: seed.code,
          name: seed.name,
          description: seed.description,
          detail: seed.detail,
          cadence: seed.cadence,
          category: seed.category,
          status: QuestDefinitionStatus.Active,
          conditionType: seed.conditionType,
          conditionJson: seed.conditionJson,
          rewardJson: seed.rewardJson,
          sortOrder: seed.sortOrder,
          isOptional: seed.isOptional,
          startsAt: null,
          endsAt: null,
        }),
      );
    }
    this.logger.log(
      `Quest catalog ensured (${QUEST_CATALOG_SEED.length} core league)`,
    );
  }
}
