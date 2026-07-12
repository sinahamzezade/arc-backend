import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

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

@Entity('role_recipes')
export class RoleRecipe {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'target_role_slug', type: 'varchar', unique: true })
  targetRoleSlug: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text', default: '' })
  summary: string;

  @Column({ name: 'default_timeline_weeks', type: 'int', default: 24 })
  defaultTimelineWeeks: number;

  @Column({ name: 'stack_plan', type: 'jsonb' })
  stackPlan: StackPlan;

  @Column({ name: 'prompt_hints', type: 'jsonb', default: () => "'{}'" })
  promptHints: Record<string, unknown>;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
