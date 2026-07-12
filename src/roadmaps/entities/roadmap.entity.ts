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
import { Goal } from '../../goals/entities/goal.entity';
import { User } from '../../users/entities/user.entity';
import { RoadmapPhase } from './roadmap-phase.entity';

export enum RoadmapStatus {
  Generating = 'generating',
  Ready = 'ready',
  Failed = 'failed',
  Archived = 'archived',
}

@Entity('roadmaps')
export class Roadmap {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'goal_id', type: 'uuid' })
  goalId: string;

  @ManyToOne(() => Goal, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'goal_id' })
  goal: Goal;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ name: 'primary_role_slug', type: 'varchar' })
  primaryRoleSlug: string;

  @Column({ name: 'timeline_weeks', type: 'int' })
  timelineWeeks: number;

  @Column({
    name: 'weekly_hours_target',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  weeklyHoursTarget: string | null;

  @Column({
    type: 'enum',
    enum: RoadmapStatus,
    default: RoadmapStatus.Generating,
  })
  status: RoadmapStatus;

  @Column({ name: 'current_phase_id', type: 'uuid', nullable: true })
  currentPhaseId: string | null;

  @Column({
    name: 'progress_percent',
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 0,
  })
  progressPercent: string;

  @Column({
    name: 'generated_by_prompt_version',
    type: 'varchar',
    default: 'roadmap_generator_v1',
  })
  generatedByPromptVersion: string;

  @Column({ name: 'generation_meta', type: 'jsonb', default: () => "'{}'" })
  generationMeta: Record<string, unknown>;

  @OneToMany(() => RoadmapPhase, (phase) => phase.roadmap)
  phases: RoadmapPhase[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
