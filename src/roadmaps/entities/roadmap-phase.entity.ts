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
import { TechStack } from '../../skill-graph/entities/tech-stack.entity';
import { Milestone } from './milestone.entity';
import { Roadmap } from './roadmap.entity';

@Entity('roadmap_phases')
export class RoadmapPhase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'roadmap_id', type: 'uuid' })
  roadmapId: string;

  @ManyToOne(() => Roadmap, (roadmap) => roadmap.phases, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'roadmap_id' })
  roadmap: Roadmap;

  @Column({ name: 'tech_stack_id', type: 'uuid', nullable: true })
  techStackId: string | null;

  @ManyToOne(() => TechStack, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'tech_stack_id' })
  techStack: TechStack | null;

  @Column({ name: 'tech_stack_slug', type: 'varchar', nullable: true })
  techStackSlug: string | null;

  @Column({ type: 'varchar' })
  title: string;

  /** Identity-progression title from role recipe (falls back to `title`). */
  @Column({ name: 'narrative_title', type: 'varchar', nullable: true })
  narrativeTitle: string | null;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ name: 'order_index', type: 'int' })
  orderIndex: number;

  @Column({ type: 'boolean', default: true })
  locked: boolean;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @OneToMany(() => Milestone, (milestone) => milestone.phase)
  milestones: Milestone[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
