import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Profile, QuestionnaireStatus } from '../profiles/entities/profile.entity';
import { QUESTIONNAIRE_SCHEMA_VERSION } from './constants/schema-version';
import { QuestionnaireDefinition } from './entities/questionnaire-definition.entity';
import { QuestionnaireOption } from './entities/questionnaire-option.entity';
import { QuestionnaireResponse } from './entities/questionnaire-response.entity';
import {
  QuestionnaireSelection,
  QuestionnaireStep,
  QuestionnaireUiKind,
} from './entities/questionnaire-step.entity';
import type { QuestionnaireAiCopy } from './questionnaire-ai.schema';
import { QuestionnaireAiService } from './questionnaire-ai.service';
import { QUESTIONNAIRE_SEED } from './schema/seed-data';
import type {
  QuestionnaireSchemaDto,
  QuestionnaireStepDto,
} from './schema/schema.types';

@Injectable()
export class QuestionnaireSchemaService implements OnModuleInit {
  private readonly logger = new Logger(QuestionnaireSchemaService.name);
  private cache: QuestionnaireSchemaDto | null = null;

  constructor(
    @InjectRepository(QuestionnaireDefinition)
    private readonly definitionsRepo: Repository<QuestionnaireDefinition>,
    private readonly questionnaireAi: QuestionnaireAiService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    if (this.config.get<string>('QUESTIONNAIRE_RESET_ON_BOOT') === 'true') {
      await this.resetAllQuestionnaireData();
    }
    await this.ensureSeeded();
    await this.reloadCache();
    await this.enrichActiveDefinitionWithAi();
    await this.ensureGoalOptionsFromSeed();
    await this.reloadCache();
  }

  getSchema(): QuestionnaireSchemaDto {
    if (!this.cache) {
      return {
        schemaVersion: QUESTIONNAIRE_SCHEMA_VERSION,
        totalSteps: 0,
        steps: [],
      };
    }
    return this.cache;
  }

  getStepById(fieldKey: string): QuestionnaireStepDto | undefined {
    return this.getSchema().steps.find((s) => s.id === fieldKey);
  }

  optionValuesForStep(fieldKey: string): string[] {
    const step = this.getStepById(fieldKey);
    if (!step) return [];
    if (step.uiKind === 'schedule') {
      return [
        ...(step.scheduleDays ?? []),
        ...(step.scheduleTimes ?? []).map((t) => t.value),
      ];
    }
    const values = step.options.map((o) => o.value);
    if (step.allowOther && step.selection === 'single') {
      return [...values, 'other'];
    }
    return values;
  }

  async reloadCache() {
    const definition = await this.definitionsRepo.findOne({
      where: { isActive: true },
      relations: { steps: { options: true } },
    });

    if (!definition) {
      this.cache = null;
      this.logger.warn('No active questionnaire definition in database');
      return;
    }

    const steps = [...(definition.steps ?? [])].sort(
      (a, b) => a.stepNumber - b.stepNumber,
    );

    this.cache = {
      schemaVersion: definition.version,
      totalSteps: steps.length,
      steps: steps.map((step) => this.toStepDto(step)),
    };
  }

  /**
   * Wipe catalog + answers so new registrations start clean.
   * Profiles questionnaire flags reset to not_started.
   */
  private async resetAllQuestionnaireData() {
    this.logger.warn('Resetting all questionnaire data in database');

    await this.dataSource.transaction(async (manager) => {
      await manager.clear(QuestionnaireResponse);
      await manager
        .createQueryBuilder()
        .delete()
        .from(QuestionnaireOption)
        .execute();
      await manager
        .createQueryBuilder()
        .delete()
        .from(QuestionnaireStep)
        .execute();
      await manager
        .createQueryBuilder()
        .delete()
        .from(QuestionnaireDefinition)
        .execute();
      await manager
        .createQueryBuilder()
        .update(Profile)
        .set({
          questionnaireStatus: QuestionnaireStatus.NotStarted,
          questionnaireCompletedAt: null,
        })
        .execute();
    });
  }

  private toStepDto(step: QuestionnaireStep): QuestionnaireStepDto {
    const options = [...(step.options ?? [])]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((opt) => ({
        value: opt.value,
        label: opt.label,
        ...(opt.icon ? { icon: opt.icon } : {}),
        ...(opt.iconClassName ? { iconClassName: opt.iconClassName } : {}),
      }));

    return {
      id: step.fieldKey,
      stepNumber: step.stepNumber,
      title: step.title,
      subtitle: step.subtitle,
      selection: step.selection,
      allowOther: step.allowOther || undefined,
      uiKind: step.uiKind,
      reviewLabel: step.reviewLabel,
      reviewIcon: step.reviewIcon,
      options,
      ...(step.scheduleDays?.length
        ? { scheduleDays: step.scheduleDays }
        : {}),
      ...(step.scheduleTimes?.length
        ? { scheduleTimes: step.scheduleTimes }
        : {}),
      ...(step.visibleWhen ? { visibleWhen: step.visibleWhen } : {}),
    };
  }

  private async ensureSeeded() {
    const existing = await this.definitionsRepo.findOne({
      where: { version: QUESTIONNAIRE_SEED.schemaVersion },
    });
    if (existing) {
      if (!existing.isActive) {
        await this.definitionsRepo.update(
          { isActive: true },
          { isActive: false },
        );
        existing.isActive = true;
        await this.definitionsRepo.save(existing);
      }
      return;
    }

    this.logger.log(
      `Seeding questionnaire definition v${QUESTIONNAIRE_SEED.schemaVersion}`,
    );

    await this.dataSource.transaction(async (manager) => {
      await manager.update(
        QuestionnaireDefinition,
        { isActive: true },
        { isActive: false },
      );

      const definition = manager.create(QuestionnaireDefinition, {
        version: QUESTIONNAIRE_SEED.schemaVersion,
        isActive: true,
        aiEnrichedAt: null,
      });
      const savedDef: QuestionnaireDefinition = await manager.save(definition);

      for (const seedStep of QUESTIONNAIRE_SEED.steps) {
        const step = manager.create(QuestionnaireStep, {
          definitionId: savedDef.id,
          fieldKey: seedStep.id,
          stepNumber: seedStep.stepNumber,
          title: seedStep.title,
          subtitle: seedStep.subtitle,
          selection:
            seedStep.selection === 'single'
              ? QuestionnaireSelection.Single
              : QuestionnaireSelection.Multi,
          allowOther: Boolean(seedStep.allowOther),
          uiKind:
            seedStep.uiKind === 'schedule'
              ? QuestionnaireUiKind.Schedule
              : QuestionnaireUiKind.Options,
          reviewLabel: seedStep.reviewLabel,
          reviewIcon: seedStep.reviewIcon,
          scheduleDays: seedStep.scheduleDays ?? null,
          scheduleTimes: seedStep.scheduleTimes ?? null,
          visibleWhen: seedStep.visibleWhen ?? null,
        });
        const savedStep: QuestionnaireStep = await manager.save(step);

        if (seedStep.options?.length) {
          const options = seedStep.options.map((opt, index) =>
            manager.create(QuestionnaireOption, {
              stepId: savedStep.id,
              value: opt.value,
              label: opt.label,
              icon: opt.icon ?? null,
              iconClassName: opt.iconClassName ?? null,
              sortOrder: index,
            }),
          );
          await manager.save(options);
        }
      }
    });
  }

  /**
   * Upsert seed goal options onto the active definition without wiping AI copy.
   * Lets catalog grow when seed roles expand between schema versions.
   */
  private async ensureGoalOptionsFromSeed() {
    const goalSeed = QUESTIONNAIRE_SEED.steps.find((s) => s.id === 'goal');
    if (!goalSeed?.options?.length) return;

    const definition = await this.definitionsRepo.findOne({
      where: { isActive: true },
      relations: { steps: { options: true } },
    });
    if (!definition) return;

    const goalStep = (definition.steps ?? []).find((s) => s.fieldKey === 'goal');
    if (!goalStep) return;

    if (goalSeed.allowOther && !goalStep.allowOther) {
      goalStep.allowOther = true;
      await this.dataSource.getRepository(QuestionnaireStep).save(goalStep);
    }
    if (goalSeed.subtitle) {
      goalStep.subtitle = goalSeed.subtitle;
      await this.dataSource.getRepository(QuestionnaireStep).save(goalStep);
    }

    const optionRepo = this.dataSource.getRepository(QuestionnaireOption);
    const existing = new Map(
      (goalStep.options ?? []).map((o) => [o.value, o]),
    );
    let maxOrder = Math.max(
      -1,
      ...(goalStep.options ?? []).map((o) => o.sortOrder),
    );
    let added = 0;

    for (const seedOpt of goalSeed.options) {
      const row = existing.get(seedOpt.value);
      if (row) {
        if (!row.icon && seedOpt.icon) {
          row.icon = seedOpt.icon;
          row.iconClassName = seedOpt.iconClassName ?? null;
          await optionRepo.save(row);
        }
        continue;
      }
      maxOrder += 1;
      await optionRepo.save(
        optionRepo.create({
          stepId: goalStep.id,
          value: seedOpt.value,
          label: seedOpt.label,
          icon: seedOpt.icon ?? null,
          iconClassName: seedOpt.iconClassName ?? null,
          sortOrder: maxOrder,
        }),
      );
      added += 1;
    }

    if (added > 0) {
      this.logger.log(`Synced ${added} goal role option(s) from seed`);
    }
  }

  private async enrichActiveDefinitionWithAi() {
    const definition = await this.definitionsRepo.findOne({
      where: { isActive: true },
      relations: { steps: { options: true } },
    });
    if (!definition) return;
    if (definition.aiEnrichedAt) {
      this.logger.log('Questionnaire AI copy already persisted — skip');
      return;
    }
    if (!(await this.questionnaireAi.isEnabled())) {
      this.logger.warn('Questionnaire AI disabled — keeping seed copy');
      return;
    }

    const base = this.getSchema();
    if (!base.steps.length) return;

    const copy = await this.questionnaireAi.generateCopy(base);
    if (!copy) {
      this.logger.warn('Questionnaire AI generate failed — keeping seed copy');
      return;
    }

    await this.persistAiCopy(definition.id, copy);
    this.logger.log(
      `Questionnaire AI copy persisted for definition v${definition.version}`,
    );
  }

  private async persistAiCopy(
    definitionId: string,
    copy: QuestionnaireAiCopy,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const stepRepo = manager.getRepository(QuestionnaireStep);
      const optionRepo = manager.getRepository(QuestionnaireOption);
      const defRepo = manager.getRepository(QuestionnaireDefinition);

      const steps = await stepRepo.find({
        where: { definitionId },
        relations: { options: true },
      });
      const stepByKey = new Map(steps.map((s) => [s.fieldKey, s]));

      for (const aiStep of copy.steps) {
        const step = stepByKey.get(aiStep.id);
        if (!step) continue;

        step.title = aiStep.title;
        step.subtitle = aiStep.subtitle;
        step.reviewLabel = aiStep.reviewLabel;

        if (step.scheduleTimes?.length && aiStep.scheduleTimes?.length) {
          const labelByValue = new Map(
            aiStep.scheduleTimes.map((t) => [t.value, t.label]),
          );
          step.scheduleTimes = step.scheduleTimes.map((t) => ({
            ...t,
            label: labelByValue.get(t.value) ?? t.label,
          }));
        }

        await stepRepo.save(step);

        if (aiStep.options?.length && step.options?.length) {
          const labelByValue = new Map(
            aiStep.options.map((o) => [o.value, o.label]),
          );
          for (const opt of step.options) {
            const label = labelByValue.get(opt.value);
            if (label) {
              opt.label = label;
              await optionRepo.save(opt);
            }
          }
        }
      }

      await defRepo.update(
        { id: definitionId },
        { aiEnrichedAt: new Date() },
      );
    });
  }
}
