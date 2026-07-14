import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuestDefinition } from './entities/quest-definition.entity';
import { QuestsCatalogSeedService } from './quests-catalog.seed.service';
import { QuestsService } from './quests.service';

@Module({
  imports: [TypeOrmModule.forFeature([QuestDefinition])],
  providers: [QuestsService, QuestsCatalogSeedService],
  exports: [QuestsService, TypeOrmModule],
})
export class QuestsModule {}
