import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { QuestionnaireStep } from './questionnaire-step.entity';

@Entity('questionnaire_options')
@Unique(['stepId', 'value'])
export class QuestionnaireOption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'step_id', type: 'uuid' })
  stepId: string;

  @ManyToOne(() => QuestionnaireStep, (step) => step.options, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'step_id' })
  step: QuestionnaireStep;

  @Column({ type: 'varchar' })
  value: string;

  @Column({ type: 'varchar' })
  label: string;

  @Column({ type: 'varchar', nullable: true })
  icon: string | null;

  @Column({ name: 'icon_class_name', type: 'varchar', nullable: true })
  iconClassName: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
