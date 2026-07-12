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
import { ContentPublicationStatus } from '../content-pool.constants';
import { CareerRole } from './career-role.entity';

@Entity('course_templates')
@Unique(['slug', 'version'])
export class CourseTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  slug: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ name: 'learning_outcome', type: 'text', default: '' })
  learningOutcome: string;

  @Column({ name: 'career_role_id', type: 'uuid', nullable: true })
  careerRoleId: string | null;

  @ManyToOne(() => CareerRole, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'career_role_id' })
  careerRole: CareerRole | null;

  @Column({
    name: 'tech_stack_slugs',
    type: 'text',
    array: true,
    default: '{}',
  })
  techStackSlugs: string[];

  @Column({ name: 'difficulty_min', type: 'varchar', default: 'beginner' })
  difficultyMin: string;

  @Column({ name: 'difficulty_max', type: 'varchar', default: 'advanced' })
  difficultyMax: string;

  @Column({ name: 'is_required', type: 'boolean', default: true })
  isRequired: boolean;

  @Column({ name: 'estimated_total_minutes', type: 'int', default: 0 })
  estimatedTotalMinutes: number;

  @Column({
    name: 'quality_score',
    type: 'numeric',
    precision: 4,
    scale: 2,
    nullable: true,
  })
  qualityScore: string | null;

  @Column({ type: 'varchar', default: 'en' })
  language: string;

  @Column({ type: 'int', default: 1 })
  version: number;

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
