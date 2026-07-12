import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Roadmap } from '../../roadmaps/entities/roadmap.entity';
import { WeeklyTask } from './weekly-task.entity';

export enum WeeklyPlanStatus {
  Building = 'building',
  Active = 'active',
  Sealed = 'sealed',
  Missed = 'missed',
  Replanned = 'replanned',
  Archived = 'archived',
}

@Entity('weekly_plans')
@Index(['userId', 'weekStart'], { unique: true })
export class WeeklyPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'roadmap_id', type: 'uuid', nullable: true })
  roadmapId: string | null;

  @ManyToOne(() => Roadmap, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'roadmap_id' })
  roadmap: Roadmap | null;

  /** Monday calendar date in user TZ (YYYY-MM-DD). */
  @Column({ name: 'week_start', type: 'date' })
  weekStart: string;

  @Column({ name: 'week_index', type: 'int' })
  weekIndex: number;

  @Column({ name: 'plan_version', type: 'int', default: 1 })
  planVersion: number;

  @Column({ name: 'schedule_version', type: 'int', default: 1 })
  scheduleVersion: number;

  @Column({ name: 'timezone_snapshot', type: 'varchar', length: 64, nullable: true })
  timezoneSnapshot: string | null;

  @Column({ name: 'window_start_at', type: 'timestamptz', nullable: true })
  windowStartAt: Date | null;

  @Column({ name: 'window_end_at', type: 'timestamptz', nullable: true })
  windowEndAt: Date | null;

  @Column({ name: 'sessions_planned', type: 'int' })
  sessionsPlanned: number;

  @Column({ name: 'sessions_done', type: 'int', default: 0 })
  sessionsDone: number;

  @Column({
    name: 'hours_planned',
    type: 'numeric',
    precision: 4,
    scale: 1,
  })
  hoursPlanned: string;

  @Column({
    name: 'hours_done',
    type: 'numeric',
    precision: 4,
    scale: 1,
    default: 0,
  })
  hoursDone: string;

  @Column({ name: 'minutes_planned', type: 'int', default: 0 })
  minutesPlanned: number;

  @Column({ name: 'verified_minutes_done', type: 'int', default: 0 })
  verifiedMinutesDone: number;

  @Column({ name: 'lock_reward_xp', type: 'int' })
  lockRewardXp: number;

  @Column({ name: 'lock_reward_gems', type: 'int' })
  lockRewardGems: number;

  @Column({
    name: 'seal_reward_rule_key',
    type: 'varchar',
    length: 64,
    default: 'week-seal-v1',
  })
  sealRewardRuleKey: string;

  @Column({
    name: 'seal_rule_snapshot',
    type: 'jsonb',
    default: () => "'{}'",
  })
  sealRuleSnapshot: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: WeeklyPlanStatus,
    default: WeeklyPlanStatus.Active,
  })
  status: WeeklyPlanStatus;

  @Column({ name: 'sealed_at', type: 'timestamptz', nullable: true })
  sealedAt: Date | null;

  @Column({ name: 'replan_count', type: 'int', default: 0 })
  replanCount: number;

  @OneToMany(() => WeeklyTask, (task) => task.plan, { cascade: true })
  tasks: WeeklyTask[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
