import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Goal } from '../../goals/entities/goal.entity';
import { User } from '../../users/entities/user.entity';
import { Roadmap } from './roadmap.entity';

export enum RoadmapJobStatus {
  Queued = 'queued',
  Processing = 'processing',
  Ready = 'ready',
  Failed = 'failed',
}

@Entity('roadmap_generation_jobs')
export class RoadmapGenerationJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'goal_id', type: 'uuid' })
  goalId: string;

  @ManyToOne(() => Goal, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'goal_id' })
  goal: Goal;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    type: 'enum',
    enum: RoadmapJobStatus,
    default: RoadmapJobStatus.Queued,
  })
  status: RoadmapJobStatus;

  @Column({ name: 'roadmap_id', type: 'uuid', nullable: true })
  roadmapId: string | null;

  @ManyToOne(() => Roadmap, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'roadmap_id' })
  roadmap: Roadmap | null;

  @Column({ name: 'error_code', type: 'varchar', nullable: true })
  errorCode: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
