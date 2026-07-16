import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Goal } from '../../goals/entities/goal.entity';
import { Roadmap } from './roadmap.entity';

export enum ReEnrollmentTrigger {
  NewGoal = 'new_goal',
  SameGoalAdvanced = 'same_goal_advanced',
  TopUp = 'top_up',
}

export enum ReEnrollmentJobStatus {
  Queued = 'queued',
  Processing = 'processing',
  Ready = 'ready',
  Failed = 'failed',
}

@Entity('re_enrollment_jobs')
export class ReEnrollmentJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'previous_roadmap_id', type: 'uuid' })
  previousRoadmapId: string;

  @ManyToOne(() => Roadmap, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'previous_roadmap_id' })
  previousRoadmap: Roadmap;

  @Column({ type: 'varchar' })
  trigger: ReEnrollmentTrigger;

  @Column({ name: 'new_goal_id', type: 'uuid', nullable: true })
  newGoalId: string | null;

  @ManyToOne(() => Goal, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'new_goal_id' })
  newGoal: Goal | null;

  @Column({
    type: 'enum',
    enum: ReEnrollmentJobStatus,
    default: ReEnrollmentJobStatus.Queued,
  })
  status: ReEnrollmentJobStatus;

  @Column({ name: 'new_roadmap_id', type: 'uuid', nullable: true })
  newRoadmapId: string | null;

  @ManyToOne(() => Roadmap, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'new_roadmap_id' })
  newRoadmap: Roadmap | null;

  @Column({ name: 'error_code', type: 'varchar', nullable: true })
  errorCode: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
