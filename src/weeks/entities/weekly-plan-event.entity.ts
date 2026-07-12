import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { WeeklyPlan } from './weekly-plan.entity';

export enum WeeklyPlanEventType {
  Generated = 'generated',
  TaskMoved = 'task_moved',
  TaskCompleted = 'task_completed',
  TaskSkipped = 'task_skipped',
  Sealed = 'sealed',
  Missed = 'missed',
  Replanned = 'replanned',
}

@Entity('weekly_plan_events')
export class WeeklyPlanEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index()
  @Column({ name: 'weekly_plan_id', type: 'uuid' })
  weeklyPlanId: string;

  @ManyToOne(() => WeeklyPlan, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'weekly_plan_id' })
  plan: WeeklyPlan;

  @Column({ type: 'enum', enum: WeeklyPlanEventType })
  type: WeeklyPlanEventType;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  payload: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
