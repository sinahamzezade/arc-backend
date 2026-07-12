import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { SkillNode } from '../../skill-graph/entities/skill-node.entity';

/** Normalized DAG edge. Array on SkillNode kept for seed/compat. */
@Entity('skill_prerequisites')
@Unique(['skillNodeId', 'prerequisiteSkillId'])
export class SkillPrerequisite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'skill_node_id', type: 'uuid' })
  skillNodeId: string;

  @ManyToOne(() => SkillNode, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'skill_node_id' })
  skillNode: SkillNode;

  @Column({ name: 'prerequisite_skill_id', type: 'uuid' })
  prerequisiteSkillId: string;

  @ManyToOne(() => SkillNode, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'prerequisite_skill_id' })
  prerequisiteSkill: SkillNode;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
