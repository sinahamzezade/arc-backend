import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { LessonTemplate } from './lesson-template.entity';
import { TechStack } from './tech-stack.entity';

@Entity('skill_nodes')
@Unique(['techStackId', 'slug'])
export class SkillNode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tech_stack_id', type: 'uuid' })
  techStackId: string;

  @ManyToOne(() => TechStack, (stack) => stack.skillNodes, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'tech_stack_id' })
  techStack: TechStack;

  @Column({ type: 'varchar' })
  slug: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ name: 'order_hint', type: 'int', default: 0 })
  orderHint: number;

  @Column({
    name: 'estimated_hours',
    type: 'numeric',
    precision: 6,
    scale: 2,
    default: 1,
  })
  estimatedHours: string;

  @Column({
    name: 'estimated_mastery_minutes',
    type: 'int',
    nullable: true,
  })
  estimatedMasteryMinutes: number | null;

  @Column({ type: 'varchar', default: 'beginner' })
  difficulty: string;

  /** Prerequisite skill node ids (DAG edges). */
  @Column({
    name: 'prerequisite_skill_ids',
    type: 'uuid',
    array: true,
    default: '{}',
  })
  prerequisiteSkillIds: string[];

  @Column({ type: 'text', array: true, default: '{}' })
  tags: string[];

  @Column({
    name: 'proof_requirements',
    type: 'jsonb',
    default: () => "'{}'",
  })
  proofRequirements: Record<string, unknown>;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany(() => LessonTemplate, (lesson) => lesson.skillNode)
  lessonTemplates: LessonTemplate[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
