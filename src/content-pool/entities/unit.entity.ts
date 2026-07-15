import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Flattened self-describing content unit.
 * Matcher reads this directly — no tree walk at match time.
 */
@Entity('units')
export class Unit {
  /** Stable slug id e.g. `html-intro-read`. */
  @PrimaryColumn({ type: 'varchar' })
  id: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({
    name: 'skills_taught',
    type: 'text',
    array: true,
    default: '{}',
  })
  skillsTaught: string[];

  @Column({
    type: 'text',
    array: true,
    default: '{}',
  })
  prerequisites: string[];

  @Column({ type: 'int', default: 1 })
  level: number;

  @Column({ name: 'estimated_minutes', type: 'int', default: 20 })
  estimatedMinutes: number;

  @Column({
    type: 'text',
    array: true,
    default: '{}',
  })
  formats: string[];

  @Column({ name: 'lesson_type', type: 'varchar' })
  lessonType: string;

  @Column({ type: 'varchar', default: 'frontend' })
  domain: string;

  @Column({ type: 'varchar' })
  stack: string;

  @Column({ type: 'varchar', nullable: true })
  provider: string | null;

  @Column({ type: 'text', nullable: true })
  url: string | null;

  @Column({ type: 'int', default: 20 })
  xp: number;

  /** Type-specific body. Quiz answers stay server-side (stripped on play). */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  content: Record<string, unknown>;

  /** Learner stages this unit is appropriate for (entry-stage matching). */
  @Column({
    name: 'serves_stage',
    type: 'int',
    array: true,
    default: '{}',
  })
  servesStage: number[];

  /** foundation | refresher | checkpoint | project | proof */
  @Column({ name: 'unit_role', type: 'varchar', default: 'foundation' })
  unitRole: string;

  /** Coarse profiling skill slug (e.g. `html-css`) matched against learner skill estimates. */
  @Column({ name: 'profile_skill_slug', type: 'varchar', nullable: true })
  profileSkillSlug: string | null;

  @Column({ name: 'source_template_id', type: 'varchar', nullable: true })
  sourceTemplateId: string | null;

  @Column({ name: 'source_version_id', type: 'varchar', nullable: true })
  sourceVersionId: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
