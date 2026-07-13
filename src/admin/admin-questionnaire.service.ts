import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { QuestionnaireDefinition } from '../questionnaire/entities/questionnaire-definition.entity';
import { QuestionnaireOption } from '../questionnaire/entities/questionnaire-option.entity';
import {
  QuestionnaireSelection,
  QuestionnaireStep,
  QuestionnaireUiKind,
} from '../questionnaire/entities/questionnaire-step.entity';
import { QuestionnaireSchemaService } from '../questionnaire/questionnaire-schema.service';
import {
  DEFAULT_ICON_CLASS,
  lucideIconChoices,
  normalizeIconName,
} from './admin-lucide-icons';

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

@Injectable()
export class AdminQuestionnaireService {
  constructor(
    @InjectRepository(QuestionnaireDefinition)
    private readonly definitions: Repository<QuestionnaireDefinition>,
    @InjectRepository(QuestionnaireStep)
    private readonly steps: Repository<QuestionnaireStep>,
    @InjectRepository(QuestionnaireOption)
    private readonly options: Repository<QuestionnaireOption>,
    private readonly schema: QuestionnaireSchemaService,
    private readonly dataSource: DataSource,
  ) {}

  iconChoices(selected?: string | null) {
    return lucideIconChoices(selected);
  }

  async nextVersion(): Promise<number> {
    const max = await this.definitions
      .createQueryBuilder('d')
      .select('MAX(d.version)', 'max')
      .getRawOne<{ max: string | null }>();
    return Number(max?.max ?? 0) + 1;
  }

  /**
   * Create a new definition version.
   * mode=blank → empty steps; mode=clone → copy steps/options from source (default: active).
   */
  async createDefinition(input: {
    mode?: 'blank' | 'clone';
    sourceId?: string;
    activate?: boolean;
  }): Promise<QuestionnaireDefinition> {
    const mode = input.mode === 'blank' ? 'blank' : 'clone';
    const version = await this.nextVersion();
    const activate = Boolean(input.activate);

    if (mode === 'blank') {
      if (activate) {
        await this.definitions
          .createQueryBuilder()
          .update(QuestionnaireDefinition)
          .set({ isActive: false })
          .execute();
      }
      const created = await this.definitions.save(
        this.definitions.create({
          version,
          isActive: activate,
          aiEnrichedAt: null,
        }),
      );
      if (activate) await this.schema.reloadCache();
      return created;
    }

    let source: QuestionnaireDefinition | null = null;
    if (input.sourceId) {
      source = await this.getDefinition(input.sourceId);
    } else {
      source = await this.definitions.findOne({
        where: { isActive: true },
        relations: { steps: { options: true } },
      });
      if (source) {
        source.steps = (source.steps ?? []).sort(
          (a, b) => a.stepNumber - b.stepNumber,
        );
        for (const step of source.steps) {
          step.options = (step.options ?? []).sort(
            (a, b) => a.sortOrder - b.sortOrder,
          );
        }
      }
    }

    if (!source) {
      // Fall back to blank if nothing to clone
      return this.createDefinition({ mode: 'blank', activate });
    }

    const createdId = await this.dataSource.transaction(async (manager) => {
      if (activate) {
        await manager
          .createQueryBuilder()
          .update(QuestionnaireDefinition)
          .set({ isActive: false })
          .execute();
      }

      const def = await manager.save(
        manager.create(QuestionnaireDefinition, {
          version,
          isActive: activate,
          aiEnrichedAt: null,
        }),
      );

      for (const srcStep of source.steps ?? []) {
        const step = await manager.save(
          manager.create(QuestionnaireStep, {
            definitionId: def.id,
            fieldKey: srcStep.fieldKey,
            stepNumber: srcStep.stepNumber,
            title: srcStep.title,
            subtitle: srcStep.subtitle,
            selection: srcStep.selection,
            allowOther: srcStep.allowOther,
            uiKind: srcStep.uiKind,
            reviewLabel: srcStep.reviewLabel,
            reviewIcon: srcStep.reviewIcon,
            scheduleDays: srcStep.scheduleDays,
            scheduleTimes: srcStep.scheduleTimes,
            visibleWhen: srcStep.visibleWhen,
          }),
        );

        if (srcStep.options?.length) {
          await manager.save(
            srcStep.options.map((opt) =>
              manager.create(QuestionnaireOption, {
                stepId: step.id,
                value: opt.value,
                label: opt.label,
                icon: opt.icon,
                iconClassName: opt.iconClassName,
                sortOrder: opt.sortOrder,
              }),
            ),
          );
        }
      }

      return def.id;
    });

    if (activate) await this.schema.reloadCache();
    return this.getDefinition(createdId);
  }

  async getDefinition(id: string) {
    const row = await this.definitions.findOne({
      where: { id },
      relations: { steps: { options: true } },
    });
    if (!row) throw new NotFoundException('Questionnaire not found');
    row.steps = (row.steps ?? []).sort((a, b) => a.stepNumber - b.stepNumber);
    for (const step of row.steps) {
      step.options = (step.options ?? []).sort(
        (a, b) => a.sortOrder - b.sortOrder,
      );
    }
    return row;
  }

  async activate(id: string) {
    const row = await this.getDefinition(id);
    await this.definitions
      .createQueryBuilder()
      .update(QuestionnaireDefinition)
      .set({ isActive: false })
      .execute();
    row.isActive = true;
    await this.definitions.save(row);
    await this.schema.reloadCache();
    return row;
  }

  async getStep(id: string) {
    const step = await this.steps.findOne({
      where: { id },
      relations: { options: true, definition: true },
    });
    if (!step) throw new NotFoundException('Step not found');
    step.options = (step.options ?? []).sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    return step;
  }

  async createStep(
    definitionId: string,
    input: {
      fieldKey: string;
      title: string;
      subtitle?: string;
      selection?: string;
      uiKind?: string;
      allowOther?: boolean;
      reviewLabel?: string;
      reviewIcon?: string;
      stepNumber?: number;
    },
  ) {
    const def = await this.definitions.findOne({ where: { id: definitionId } });
    if (!def) throw new NotFoundException('Questionnaire not found');

    const fieldKey = slugify(input.fieldKey);
    if (!fieldKey) throw new BadRequestException('Field key required');

    const clash = await this.steps.findOne({
      where: { definitionId, fieldKey },
    });
    if (clash) {
      throw new BadRequestException(`Step "${fieldKey}" already exists`);
    }

    let stepNumber = input.stepNumber;
    if (stepNumber === undefined || !Number.isFinite(stepNumber)) {
      const max = await this.steps
        .createQueryBuilder('s')
        .select('MAX(s.step_number)', 'max')
        .where('s.definition_id = :definitionId', { definitionId })
        .getRawOne<{ max: string | null }>();
      stepNumber = Number(max?.max ?? 0) + 1;
    }

    const numberClash = await this.steps.findOne({
      where: { definitionId, stepNumber },
    });
    if (numberClash) {
      throw new BadRequestException(`Step number ${stepNumber} taken`);
    }

    const selection =
      input.selection === 'single'
        ? QuestionnaireSelection.Single
        : QuestionnaireSelection.Multi;
    const uiKind =
      input.uiKind === 'schedule'
        ? QuestionnaireUiKind.Schedule
        : QuestionnaireUiKind.Options;

    const title = input.title.trim() || fieldKey;
    const step = await this.steps.save(
      this.steps.create({
        definitionId,
        fieldKey,
        stepNumber,
        title,
        subtitle: input.subtitle?.trim() ?? '',
        selection,
        uiKind,
        allowOther: Boolean(input.allowOther),
        reviewLabel: input.reviewLabel?.trim() || title,
        reviewIcon: input.reviewIcon?.trim() || 'target',
        scheduleDays:
          uiKind === QuestionnaireUiKind.Schedule
            ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
            : null,
        scheduleTimes:
          uiKind === QuestionnaireUiKind.Schedule
            ? [
                { value: 'morning', label: 'Morning' },
                { value: 'afternoon', label: 'Afternoon' },
                { value: 'evening', label: 'Evening' },
              ]
            : null,
        visibleWhen: null,
      }),
    );
    await this.schema.reloadCache();
    return step;
  }

  async updateStep(
    id: string,
    input: {
      title?: string;
      subtitle?: string;
      selection?: string;
      uiKind?: string;
      allowOther?: boolean;
      reviewLabel?: string;
      reviewIcon?: string;
      stepNumber?: number;
      fieldKey?: string;
      scheduleDays?: string;
      scheduleTimesJson?: string;
    },
  ) {
    const step = await this.getStep(id);

    if (input.fieldKey !== undefined) {
      const fieldKey = slugify(input.fieldKey);
      if (!fieldKey) throw new BadRequestException('Field key required');
      if (fieldKey !== step.fieldKey) {
        const clash = await this.steps.findOne({
          where: { definitionId: step.definitionId, fieldKey },
        });
        if (clash) {
          throw new BadRequestException(`Step "${fieldKey}" already exists`);
        }
        step.fieldKey = fieldKey;
      }
    }

    if (input.stepNumber !== undefined && Number.isFinite(input.stepNumber)) {
      if (input.stepNumber !== step.stepNumber) {
        const clash = await this.steps.findOne({
          where: {
            definitionId: step.definitionId,
            stepNumber: input.stepNumber,
          },
        });
        if (clash) {
          throw new BadRequestException(
            `Step number ${input.stepNumber} taken`,
          );
        }
        step.stepNumber = input.stepNumber;
      }
    }

    if (input.title !== undefined) step.title = input.title.trim();
    if (input.subtitle !== undefined) step.subtitle = input.subtitle.trim();
    if (input.reviewLabel !== undefined) {
      step.reviewLabel = input.reviewLabel.trim() || step.title;
    }
    if (input.reviewIcon !== undefined) {
      step.reviewIcon = input.reviewIcon.trim() || 'target';
    }
    if (input.allowOther !== undefined) step.allowOther = input.allowOther;
    if (input.selection !== undefined) {
      step.selection =
        input.selection === 'single'
          ? QuestionnaireSelection.Single
          : QuestionnaireSelection.Multi;
    }
    if (input.uiKind !== undefined) {
      step.uiKind =
        input.uiKind === 'schedule'
          ? QuestionnaireUiKind.Schedule
          : QuestionnaireUiKind.Options;
    }

    if (input.scheduleDays !== undefined) {
      const days = input.scheduleDays
        .split(/[,\n]/)
        .map((d) => d.trim())
        .filter(Boolean);
      step.scheduleDays = days.length ? days : null;
    }
    if (input.scheduleTimesJson !== undefined) {
      const raw = input.scheduleTimesJson.trim();
      if (!raw) {
        step.scheduleTimes = null;
      } else {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (!Array.isArray(parsed)) {
            throw new Error('must be array');
          }
          step.scheduleTimes = parsed.map((item) => {
            const row = item as { value?: string; label?: string };
            return {
              value: String(row.value ?? '').trim(),
              label: String(row.label ?? row.value ?? '').trim(),
            };
          });
        } catch {
          throw new BadRequestException(
            'scheduleTimes must be JSON array of {value,label}',
          );
        }
      }
    }

    await this.steps.save(step);
    await this.schema.reloadCache();
    return this.getStep(id);
  }

  async deleteStep(id: string) {
    const step = await this.getStep(id);
    await this.steps.remove(step);
    await this.schema.reloadCache();
  }

  async createOption(
    stepId: string,
    input: {
      label: string;
      value?: string;
      icon?: string;
      sortOrder?: number;
    },
  ) {
    const step = await this.getStep(stepId);
    const label = input.label.trim();
    if (!label) throw new BadRequestException('Label required');
    const value = slugify(input.value?.trim() || label);
    if (!value) throw new BadRequestException('Value required');

    const exists = await this.options.findOne({
      where: { stepId: step.id, value },
    });
    if (exists) {
      throw new BadRequestException(`Option "${value}" already exists`);
    }

    let sortOrder = input.sortOrder;
    if (sortOrder === undefined || !Number.isFinite(sortOrder)) {
      const max = await this.options
        .createQueryBuilder('o')
        .select('MAX(o.sort_order)', 'max')
        .where('o.step_id = :stepId', { stepId: step.id })
        .getRawOne<{ max: string | null }>();
      sortOrder = Number(max?.max ?? -1) + 1;
    }

    const icon = input.icon ? normalizeIconName(input.icon) : null;
    const row = await this.options.save(
      this.options.create({
        stepId: step.id,
        value,
        label,
        icon,
        iconClassName: icon ? DEFAULT_ICON_CLASS : null,
        sortOrder,
      }),
    );
    await this.schema.reloadCache();
    return row;
  }

  async updateOption(
    id: string,
    input: {
      label?: string;
      value?: string;
      icon?: string;
      sortOrder?: number;
    },
  ) {
    const opt = await this.options.findOne({
      where: { id },
      relations: { step: true },
    });
    if (!opt) throw new NotFoundException('Option not found');

    if (input.label !== undefined) {
      const label = input.label.trim();
      if (!label) throw new BadRequestException('Label required');
      opt.label = label;
    }
    if (input.value !== undefined) {
      const value = slugify(input.value);
      if (!value) throw new BadRequestException('Value required');
      if (value !== opt.value) {
        const clash = await this.options.findOne({
          where: { stepId: opt.stepId, value },
        });
        if (clash) {
          throw new BadRequestException(`Option "${value}" already exists`);
        }
        opt.value = value;
      }
    }
    if (input.icon !== undefined) {
      const icon = input.icon.trim()
        ? normalizeIconName(input.icon)
        : null;
      opt.icon = icon;
      opt.iconClassName = icon ? DEFAULT_ICON_CLASS : null;
    }
    if (input.sortOrder !== undefined && Number.isFinite(input.sortOrder)) {
      opt.sortOrder = input.sortOrder;
    }

    await this.options.save(opt);
    await this.schema.reloadCache();
    return opt;
  }

  async deleteOption(id: string) {
    const opt = await this.options.findOne({ where: { id } });
    if (!opt) throw new NotFoundException('Option not found');
    await this.options.remove(opt);
    await this.schema.reloadCache();
  }
}
