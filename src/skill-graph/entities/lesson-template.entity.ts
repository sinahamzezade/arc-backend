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

  @Column({
    name: 'learning_style_tags',
    type: 'text',
    array: true,
    default: '{}',
  })
  learningStyleTags: string[];

  @Column({ name: 'order_hint', type: 'int', default: 0 })
  orderHint: number;

  @Column({ name: 'default_resource_id', type: 'uuid', nullable: true })
  defaultResourceId: string | null;

  @ManyToOne(() => Resource, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'default_resource_id' })
  defaultResource: Resource | null;

  @Column({ name: 'content_outline', type: 'jsonb', default: () => "'{}'" })
  contentOutline: Record<string, unknown>;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
