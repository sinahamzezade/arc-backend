import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Resource } from '../../skill-graph/entities/resource.entity';
import { Milestone } from './milestone.entity';

export enum LessonStatus {
  Locked = 'locked',
  Available = 'available',
  Completed = 'completed',
}

@Entity('lessons')
export class Lesson {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'milestone_id', type: 'uuid' })
  milestoneId: string;

  @ManyToOne(() => Milestone, (milestone) => milestone.lessons, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'milestone_id' })
  milestone: Milestone;

  /** Source unit slug this lesson was materialized from (units.id). */
  @Column({ name: 'unit_id', type: 'varchar', nullable: true })
  unitId: string | null;

  /** @deprecated legacy skill-graph template ref — unused by play APIs. */
  @Column({ name: 'lesson_template_id', type: 'uuid', nullable: true })
  lessonTemplateId: string | null;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ name: 'mission_name', type: 'varchar', nullable: true })
  missionName: string | null;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ name: 'lesson_type', type: 'varchar' })
  lessonType: string;

  @Column({ name: 'estimated_minutes', type: 'int', default: 20 })
  estimatedMinutes: number;

  @Column({ type: 'varchar', default: 'beginner' })
  difficulty: string;

  @Column({ name: 'xp_reward', type: 'int', default: 20 })
  xpReward: number;

  @Column({ name: 'order_index', type: 'int' })
  orderIndex: number;

  /** Required lessons block roadmap graduation; optional enrichment does not. */
  @Column({ type: 'boolean', default: true })
  required: boolean;

  @Column({ name: 'resource_id', type: 'uuid', nullable: true })
  resourceId: string | null;

  @ManyToOne(() => Resource, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resource_id' })
  resource: Resource | null;

  @Column({
    type: 'enum',
    enum: LessonStatus,
    default: LessonStatus.Locked,
  })
  status: LessonStatus;

  /** Type-specific unit body snapshot (authoritative play payload). */
  @Column({ name: 'play_content', type: 'jsonb', nullable: true })
  playContent: Record<string, unknown> | null;

  /** @deprecated legacy content-pool pin — unused by play APIs. */
  @Column({ name: 'source_version_id', type: 'uuid', nullable: true })
  sourceVersionId: string | null;

  /** External resource provider snapshot from the unit (e.g. `mdn`). */
  @Column({ type: 'varchar', nullable: true })
  provider: string | null;

  /** External resource URL snapshot from the unit. */
  @Column({ type: 'text', nullable: true })
  url: string | null;

  /** Unit difficulty level snapshot. */
  @Column({ type: 'int', nullable: true, default: 1 })
  level: number | null;

  /** Skill slugs the source unit teaches (unit.skills_taught snapshot). */
  @Column({
    name: 'skills_taught',
    type: 'text',
    array: true,
    default: '{}',
  })
  skillsTaught: string[];

  /** Unit role snapshot (foundation | refresher | checkpoint | project | proof). */
  @Column({ name: 'unit_role', type: 'varchar', nullable: true })
  unitRole: string | null;

  /** Learner stages the source unit serves (unit.serves_stage snapshot). */
  @Column({
    name: 'serves_stage',
    type: 'int',
    array: true,
    default: '{}',
  })
  servesStage: number[];

  /** Stage-aware plan action this lesson was scheduled under. */
  @Column({ name: 'entry_action', type: 'varchar', nullable: true })
  entryAction: string | null;

  /** Snapshot of template reward class (not wallet amount). */
  @Column({ name: 'reward_class_snapshot', type: 'varchar', nullable: true })
  rewardClassSnapshot: string | null;

  /** Window batch this lesson was materialized into (null = outline-only). */
  @Column({ name: 'materialized_window', type: 'int', nullable: true })
  materializedWindow: number | null;

  @Column({ type: 'text', nullable: true })
  objective: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
