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
import { ContentPublicationStatus } from '../../content-pool/content-pool.constants';
import { Resource } from './resource.entity';
import { SkillNode } from './skill-node.entity';

@Entity('lesson_templates')
@Unique(['skillNodeId', 'slug'])
export class LessonTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'skill_node_id', type: 'uuid' })
  skillNodeId: string;

  @ManyToOne(() => SkillNode, (node) => node.lessonTemplates, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'skill_node_id' })
  skillNode: SkillNode;

  @Column({ type: 'varchar' })
  slug: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ name: 'mission_name_template', type: 'varchar', nullable: true })
  missionNameTemplate: string | null;

  @Column({ name: 'lesson_type', type: 'varchar' })
  lessonType: string;

  @Column({ name: 'estimated_minutes', type: 'int', default: 20 })
  estimatedMinutes: number;

  @Column({ type: 'varchar', default: 'beginner' })
  difficulty: string;

  @Column({ name: 'xp_reward', type: 'int', default: 20 })
  xpReward: number;

  /** Reward class snapshot target — not final wallet amount. */
  @Column({ name: 'reward_class', type: 'varchar', default: 'standard' })
  rewardClass: string;

  @Column({
    name: 'learning_style_tags',
    type: 'text',
    array: true,
    default: '{}',
  })
  learningStyleTags: string[];

  @Column({
    name: 'scheduling_tags',
    type: 'text',
    array: true,
    default: '{}',
  })
  schedulingTags: string[];

  @Column({
    name: 'modality_requirements',
    type: 'text',
    array: true,
    default: '{}',
  })
  modalityRequirements: string[];

  @Column({
    name: 'prerequisite_lesson_ids',
    type: 'uuid',
    array: true,
    default: '{}',
  })
  prerequisiteLessonIds: string[];

  @Column({
    name: 'prerequisite_skill_ids',
    type: 'uuid',
    array: true,
    default: '{}',
  })
  prerequisiteSkillIds: string[];

  @Column({
    name: 'content_safety_flags',
    type: 'text',
    array: true,
    default: '{}',
  })
  contentSafetyFlags: string[];

  @Column({ type: 'varchar', default: 'en' })
  language: string;

  @Column({ name: 'order_hint', type: 'int', default: 0 })
  orderHint: number;

  @Column({ name: 'default_resource_id', type: 'uuid', nullable: true })
  defaultResourceId: string | null;

  @ManyToOne(() => Resource, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'default_resource_id' })
  defaultResource: Resource | null;

  /** Legacy/seed outline; published play body prefers LessonVersion. */
  @Column({ name: 'content_outline', type: 'jsonb', default: () => "'{}'" })
  contentOutline: Record<string, unknown>;

  @Column({ name: 'published_version_id', type: 'uuid', nullable: true })
  publishedVersionId: string | null;

  @Column({
    type: 'varchar',
    default: ContentPublicationStatus.Published,
  })
  status: ContentPublicationStatus;

  @Column({
    name: 'quality_score',
    type: 'numeric',
    precision: 4,
    scale: 2,
    nullable: true,
  })
  qualityScore: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
