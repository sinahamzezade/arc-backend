import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CareerRole } from '../content-pool/entities/career-role.entity';
import { QuestionnaireDefinition } from '../questionnaire/entities/questionnaire-definition.entity';
import { QuestionnaireOption } from '../questionnaire/entities/questionnaire-option.entity';
import { QuestionnaireStep } from '../questionnaire/entities/questionnaire-step.entity';
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
export class AdminRolesService {
  constructor(
    @InjectRepository(CareerRole)
    private readonly roles: Repository<CareerRole>,
    @InjectRepository(QuestionnaireDefinition)
    private readonly definitions: Repository<QuestionnaireDefinition>,
    @InjectRepository(QuestionnaireStep)
    private readonly steps: Repository<QuestionnaireStep>,
    @InjectRepository(QuestionnaireOption)
    private readonly options: Repository<QuestionnaireOption>,
    private readonly schema: QuestionnaireSchemaService,
  ) {}

  iconChoices(selected?: string | null) {
    return lucideIconChoices(selected);
  }

  listRoles() {
    return this.roles.find({ order: { title: 'ASC' } });
  }

  async createRole(input: {
    title: string;
    slug?: string;
    description?: string;
    category?: string;
    icon?: string;
    iconClassName?: string;
    addToQuestionnaire?: boolean;
  }) {
    const title = input.title.trim();
    if (!title) throw new BadRequestException('Title required');
    const slug = slugify(input.slug?.trim() || title);
    if (!slug) throw new BadRequestException('Slug required');

    const existing = await this.roles.findOne({ where: { slug } });
    if (existing) throw new BadRequestException(`Role slug "${slug}" exists`);

    const role = await this.roles.save(
      this.roles.create({
        slug,
        title,
        description: input.description?.trim() ?? '',
        category: input.category?.trim() || 'career',
        isActive: true,
      }),
    );

    if (input.addToQuestionnaire !== false) {
      const icon = normalizeIconName(input.icon);
      await this.upsertGoalOption({
        value: slug,
        label: title,
        icon,
        iconClassName: input.iconClassName?.trim() || DEFAULT_ICON_CLASS,
      });
    }

    return role;
  }

  async setActive(id: string, isActive: boolean) {
    const role = await this.roles.findOne({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');
    role.isActive = isActive;
    await this.roles.save(role);

    const goal = await this.findGoalStep();
    if (goal) {
      const opt = await this.options.findOne({
        where: { stepId: goal.id, value: role.slug },
      });
      if (!isActive && opt) {
        await this.options.remove(opt);
        await this.schema.reloadCache();
      } else if (isActive && !opt) {
        await this.upsertGoalOption({
          value: role.slug,
          label: role.title,
          icon: 'Briefcase',
          iconClassName: DEFAULT_ICON_CLASS,
        });
      }
    }

    return role;
  }

  async syncActiveRolesToQuestionnaire() {
    const roles = await this.roles.find({
      where: { isActive: true },
      order: { title: 'ASC' },
    });
    let added = 0;
    for (const role of roles) {
      const before = await this.options.count({
        where: { value: role.slug },
      });
      await this.upsertGoalOption({
        value: role.slug,
        label: role.title,
        icon: 'Briefcase',
        iconClassName: DEFAULT_ICON_CLASS,
      });
      const after = await this.options.count({
        where: { value: role.slug },
      });
      if (after > before) added += 1;
    }
    await this.schema.reloadCache();
    return { synced: roles.length, added };
  }

  async listGoalOptions() {
    const step = await this.requireGoalStep();
    return this.options.find({
      where: { stepId: step.id },
      order: { sortOrder: 'ASC', label: 'ASC' },
    });
  }

  async getGoalOption(id: string) {
    const step = await this.requireGoalStep();
    const opt = await this.options.findOne({
      where: { id, stepId: step.id },
    });
    if (!opt) throw new NotFoundException('Questionnaire role not found');
    return opt;
  }

  async createGoalOption(input: {
    label: string;
    value?: string;
    icon?: string;
    sortOrder?: number;
  }) {
    const label = input.label.trim();
    if (!label) throw new BadRequestException('Label required');
    const value = slugify(input.value?.trim() || label);
    if (!value) throw new BadRequestException('Value/slug required');

    const step = await this.requireGoalStep();
    const exists = await this.options.findOne({
      where: { stepId: step.id, value },
    });
    if (exists) {
      throw new BadRequestException(`Goal option "${value}" already exists`);
    }

    const icon = normalizeIconName(input.icon);

    let sortOrder = input.sortOrder;
    if (sortOrder === undefined || !Number.isFinite(sortOrder)) {
      const maxOrder = await this.options
        .createQueryBuilder('o')
        .select('MAX(o.sort_order)', 'max')
        .where('o.step_id = :stepId', { stepId: step.id })
        .getRawOne<{ max: string | null }>();
      sortOrder = Number(maxOrder?.max ?? -1) + 1;
    }

    const row = await this.options.save(
      this.options.create({
        stepId: step.id,
        value,
        label,
        icon,
        iconClassName: DEFAULT_ICON_CLASS,
        sortOrder,
      }),
    );
    await this.schema.reloadCache();
    return row;
  }

  async updateGoalOption(
    id: string,
    input: {
      label?: string;
      value?: string;
      icon?: string;
      sortOrder?: number;
    },
  ) {
    const opt = await this.getGoalOption(id);
    if (input.label !== undefined) {
      const label = input.label.trim();
      if (!label) throw new BadRequestException('Label required');
      opt.label = label;
    }
    if (input.value !== undefined) {
      const value = slugify(input.value);
      if (!value) throw new BadRequestException('Value/slug required');
      if (value !== opt.value) {
        const clash = await this.options.findOne({
          where: { stepId: opt.stepId, value },
        });
        if (clash) {
          throw new BadRequestException(`Goal option "${value}" already exists`);
        }
        opt.value = value;
      }
    }
    if (input.icon !== undefined) {
      opt.icon = normalizeIconName(input.icon);
      opt.iconClassName = DEFAULT_ICON_CLASS;
    }
    if (input.sortOrder !== undefined && Number.isFinite(input.sortOrder)) {
      opt.sortOrder = input.sortOrder;
    }
    await this.options.save(opt);
    await this.schema.reloadCache();
    return opt;
  }

  async deleteGoalOption(id: string) {
    const opt = await this.getGoalOption(id);
    await this.options.remove(opt);
    await this.schema.reloadCache();
  }

  private async requireGoalStep() {
    const step = await this.findGoalStep();
    if (!step) {
      throw new BadRequestException('Active questionnaire goal step missing');
    }
    return step;
  }

  private async findGoalStep() {
    const definition = await this.definitions.findOne({
      where: { isActive: true },
    });
    if (!definition) return null;
    return this.steps.findOne({
      where: { definitionId: definition.id, fieldKey: 'goal' },
    });
  }

  private async upsertGoalOption(input: {
    value: string;
    label: string;
    icon: string | null;
    iconClassName: string | null;
  }) {
    const step = await this.requireGoalStep();
    let opt = await this.options.findOne({
      where: { stepId: step.id, value: input.value },
    });
    if (opt) {
      opt.label = input.label;
      if (input.icon) opt.icon = input.icon;
      if (input.iconClassName) opt.iconClassName = input.iconClassName;
      await this.options.save(opt);
    } else {
      const maxOrder = await this.options
        .createQueryBuilder('o')
        .select('MAX(o.sort_order)', 'max')
        .where('o.step_id = :stepId', { stepId: step.id })
        .getRawOne<{ max: string | null }>();
      const sortOrder = Number(maxOrder?.max ?? -1) + 1;
      await this.options.save(
        this.options.create({
          stepId: step.id,
          value: input.value,
          label: input.label,
          icon: input.icon,
          iconClassName: input.iconClassName,
          sortOrder,
        }),
      );
    }
    await this.schema.reloadCache();
  }
}
