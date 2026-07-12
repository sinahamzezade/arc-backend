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
import { SkillNode } from './skill-node.entity';

/** Assessment nodes on the skill graph (catalog only). */
@Entity('assessment_templates')
@Unique(['skillNodeId', 'slug'])
export class AssessmentTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'skill_node_id', type: 'uuid' })
  skillNodeId: string;

  @ManyToOne(() => SkillNode, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'skill_node_id' })
  skillNode: SkillNode;

  @Column({ type: 'varchar' })
  slug: string;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ name: 'estimated_minutes', type: 'int', default: 30 })
  estimatedMinutes: number;

  @Column({ name: 'xp_reward', type: 'int', default: 50 })
  xpReward: number;

  @Column({ name: 'order_hint', type: 'int', default: 0 })
  orderHint: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
