import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { StepVisibleWhen } from '../schema/schema.types';
import { QuestionnaireDefinition } from './questionnaire-definition.entity';
import { QuestionnaireOption } from './questionnaire-option.entity';

export enum QuestionnaireSelection {
  Single = 'single',
  Multi = 'multi',
}

export enum QuestionnaireUiKind {
  Options = 'options',
  Schedule = 'schedule',
}

export type ScheduleTimeOption = {
  value: string;
  label: string;
};

@Entity('questionnaire_steps')
@Unique(['definitionId', 'fieldKey'])
@Unique(['definitionId', 'stepNumber'])
export class QuestionnaireStep {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'definition_id', type: 'uuid' })
  definitionId: string;

  @ManyToOne(() => QuestionnaireDefinition, (def) => def.steps, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'definition_id' })
  definition: QuestionnaireDefinition;

  /** Answer key, e.g. goal / motivation / schedule */
  @Column({ name: 'field_key', type: 'varchar' })
  fieldKey: string;

  @Column({ name: 'step_number', type: 'int' })
  stepNumber: number;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'varchar' })
  subtitle: string;

  @Column({
    type: 'enum',
    enum: QuestionnaireSelection,
  })
  selection: QuestionnaireSelection;

  @Column({ name: 'allow_other', type: 'boolean', default: false })
  allowOther: boolean;

  @Column({
    name: 'ui_kind',
    type: 'enum',
    enum: QuestionnaireUiKind,
    default: QuestionnaireUiKind.Options,
  })
  uiKind: QuestionnaireUiKind;

  @Column({ name: 'review_label', type: 'varchar' })
  reviewLabel: string;

  @Column({ name: 'review_icon', type: 'varchar' })
  reviewIcon: string;

  @Column({ name: 'schedule_days', type: 'jsonb', nullable: true })
  scheduleDays: string[] | null;

  @Column({ name: 'schedule_times', type: 'jsonb', nullable: true })
  scheduleTimes: ScheduleTimeOption[] | null;

  /** Adaptive branch rules; null = always show. */
  @Column({ name: 'visible_when', type: 'jsonb', nullable: true })
  visibleWhen: StepVisibleWhen | StepVisibleWhen[] | null;

  @OneToMany(() => QuestionnaireOption, (opt) => opt.step, { cascade: true })
  options: QuestionnaireOption[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
