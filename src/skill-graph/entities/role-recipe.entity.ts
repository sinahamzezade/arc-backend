import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CareerRole } from '../../content-pool/entities/career-role.entity';

export type StackPlanPhase = {
  key: string;
  title: string;
  tech_stack_slugs: string[];
  required: boolean;
  include_if_confidence_gte?: string;
};

export type StackPlan = {
  phases: StackPlanPhase[];
};

export type MinimumAssessmentRules = {
  requireDiagnosticForSkip?: boolean;
  minConfidenceForSkip?: string;
};

@Entity('role_recipes')
export class RoleRecipe {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'career_role_id', type: 'uuid', nullable: true })
  careerRoleId: string | null;

  @ManyToOne(() => CareerRole, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'career_role_id' })
  careerRole: CareerRole | null;

  @Column({ name: 'target_role_slug', type: 'varchar', unique: true })
  targetRoleSlug: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text', default: '' })
  summary: string;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ name: 'default_timeline_weeks', type: 'int', default: 24 })
  defaultTimelineWeeks: number;

  /** Legacy phase blueprint (kept for generator). */
  @Column({ name: 'stack_plan', type: 'jsonb' })
  stackPlan: StackPlan;

  @Column({
    name: 'required_skill_node_ids',
    type: 'uuid',
    array: true,
    default: '{}',
  })
  requiredSkillNodeIds: string[];

  @Column({
    name: 'optional_skill_node_ids',
    type: 'uuid',
    array: true,
    default: '{}',
  })
  optionalSkillNodeIds: string[];

  @Column({
    name: 'minimum_assessment_rules',
    type: 'jsonb',
    default: () => "'{}'",
  })
  minimumAssessmentRules: MinimumAssessmentRules;

  @Column({ name: 'prompt_hints', type: 'jsonb', default: () => "'{}'" })
  promptHints: Record<string, unknown>;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
