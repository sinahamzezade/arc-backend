import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Lesson } from '../../roadmaps/entities/lesson.entity';
import { WeeklyPlan } from './weekly-plan.entity';

export enum WeeklyTaskStatus {
  Upcoming = 'upcoming',
  Today = 'today',
  Done = 'done',
  Missed = 'missed',
  Skipped = 'skipped',
}

@Entity('weekly_tasks')
export class WeeklyTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'weekly_plan_id', type: 'uuid' })
  weeklyPlanId: string;

  @ManyToOne(() => WeeklyPlan, (plan) => plan.tasks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'weekly_plan_id' })
  plan: WeeklyPlan;

  @Column({ name: 'lesson_id', type: 'uuid', nullable: true })
  lessonId: string | null;

  @ManyToOne(() => Lesson, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'lesson_id' })
  lesson: Lesson | null;

  /** 0=Mon … 6=Sun */
  @Column({ name: 'day_index', type: 'smallint' })
  dayIndex: number;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'varchar', default: '' })
  track: string;

  @Column({ type: 'int' })
  minutes: number;

  @Column({ name: 'xp_reward', type: 'int', default: 20 })
  xpReward: number;

  @Column({
    type: 'enum',
    enum: WeeklyTaskStatus,
    default: WeeklyTaskStatus.Upcoming,
  })
  status: WeeklyTaskStatus;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'varchar', nullable: true })
  href: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
