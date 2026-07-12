import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LessonTemplate } from '../../skill-graph/entities/lesson-template.entity';
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

  @Column({ name: 'lesson_template_id', type: 'uuid', nullable: true })
  lessonTemplateId: string | null;

  @ManyToOne(() => LessonTemplate, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'lesson_template_id' })
  lessonTemplate: LessonTemplate | null;

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

  /** Optional per-lesson play payload override (else template.contentOutline). */
  @Column({ name: 'play_content', type: 'jsonb', nullable: true })
  playContent: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  objective: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
