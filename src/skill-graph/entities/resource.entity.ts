import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('resources')
export class Resource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  slug: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text' })
  url: string;

  @Column({ type: 'varchar' })
  provider: string;

  @Column({ name: 'resource_type', type: 'varchar' })
  resourceType: string;

  @Column({ name: 'skill_tags', type: 'text', array: true, default: '{}' })
  skillTags: string[];

  @Column({
    name: 'tech_stack_slugs',
    type: 'text',
    array: true,
    default: '{}',
  })
  techStackSlugs: string[];

  @Column({ type: 'varchar', default: 'beginner' })
  difficulty: string;

  @Column({ name: 'estimated_minutes', type: 'int', nullable: true })
  estimatedMinutes: number | null;

  @Column({ type: 'varchar', default: 'en' })
  language: string;

  @Column({
    name: 'quality_score',
    type: 'numeric',
    precision: 4,
    scale: 2,
    nullable: true,
  })
  qualityScore: string | null;

  @Column({ name: 'is_free', type: 'boolean', default: true })
  isFree: boolean;

  @Column({ name: 'last_checked_at', type: 'timestamptz', nullable: true })
  lastCheckedAt: Date | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
