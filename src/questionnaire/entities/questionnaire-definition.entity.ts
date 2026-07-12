import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { QuestionnaireStep } from './questionnaire-step.entity';

@Entity('questionnaire_definitions')
export class QuestionnaireDefinition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int', unique: true })
  version: number;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive: boolean;

  /** null = seed copy only; set when OpenAI rewrite persisted */
  @Column({ name: 'ai_enriched_at', type: 'timestamptz', nullable: true })
  aiEnrichedAt: Date | null;

  @OneToMany(() => QuestionnaireStep, (step) => step.definition, {
    cascade: true,
  })
  steps: QuestionnaireStep[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
