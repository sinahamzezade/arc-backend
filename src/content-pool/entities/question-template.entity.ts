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
import { SkillNode } from '../../skill-graph/entities/skill-node.entity';
import {
  ContentPublicationStatus,
  type QuestionAllowedContext,
} from '../content-pool.constants';

@Entity('question_templates')
@Unique(['skillNodeId', 'slug'])
export class QuestionTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'skill_node_id', type: 'uuid', nullable: true })
  skillNodeId: string | null;

  @ManyToOne(() => SkillNode, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'skill_node_id' })
  skillNode: SkillNode | null;

  @Column({ name: 'tech_stack_slug', type: 'varchar', nullable: true })
  techStackSlug: string | null;

  @Column({ type: 'varchar' })
  slug: string;

  @Column({ name: 'question_type', type: 'varchar' })
  questionType: string;

  @Column({ type: 'varchar', default: 'beginner' })
  difficulty: string;

  @Column({
    name: 'difficulty_score',
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 0.5,
  })
  difficultyScore: string;

  @Column({ name: 'estimated_seconds', type: 'int', default: 45 })
  estimatedSeconds: number;

  @Column({
    name: 'allowed_contexts',
    type: 'text',
    array: true,
    default: '{lesson,assessment,battle}',
  })
  allowedContexts: QuestionAllowedContext[];

  @Column({ name: 'exposure_limit', type: 'int', nullable: true })
  exposureLimit: number | null;

  @Column({
    name: 'discrimination',
    type: 'numeric',
    precision: 5,
    scale: 3,
    nullable: true,
  })
  discrimination: string | null;

  @Column({
    name: 'quality_score',
    type: 'numeric',
    precision: 4,
    scale: 2,
    nullable: true,
  })
  qualityScore: string | null;

  @Column({
    name: 'published_version_id',
    type: 'uuid',
    nullable: true,
  })
  publishedVersionId: string | null;

  @Column({
    type: 'varchar',
    default: ContentPublicationStatus.Draft,
  })
  status: ContentPublicationStatus;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
