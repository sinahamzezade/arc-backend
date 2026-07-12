import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SkillNode } from '../../skill-graph/entities/skill-node.entity';
import { Lesson } from './lesson.entity';
import { RoadmapPhase } from './roadmap-phase.entity';

@Entity('milestones')
export class Milestone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'phase_id', type: 'uuid' })
  phaseId: string;

  @ManyToOne(() => RoadmapPhase, (phase) => phase.milestones, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'phase_id' })
  phase: RoadmapPhase;

  @Column({ name: 'skill_node_id', type: 'uuid', nullable: true })
  skillNodeId: string | null;

  @ManyToOne(() => SkillNode, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'skill_node_id' })
  skillNode: SkillNode | null;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'varchar', default: 'skill' })
  type: string;

  @Column({ name: 'order_index', type: 'int' })
  orderIndex: number;

  @Column({ name: 'xp_reward', type: 'int', default: 50 })
  xpReward: number;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @OneToMany(() => Lesson, (lesson) => lesson.milestone)
  lessons: Lesson[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
