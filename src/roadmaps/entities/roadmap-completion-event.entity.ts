import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Roadmap } from './roadmap.entity';

export type RoadmapNextAction =
  | 'new_goal'
  | 'same_goal_advanced'
  | 'top_up';

/** Append-only graduation record — one row per completed roadmap. */
@Entity('roadmap_completion_events')
export class RoadmapCompletionEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'roadmap_id', type: 'uuid' })
  roadmapId: string;

  @ManyToOne(() => Roadmap, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roadmap_id' })
  roadmap: Roadmap;

  @Column({ name: 'skills_mastered', type: 'int', default: 0 })
  skillsMastered: number;

  @Column({ name: 'skills_partial', type: 'int', default: 0 })
  skillsPartial: number;

  @Column({ name: 'skills_shaky', type: 'int', default: 0 })
  skillsShaky: number;

  @Column({ name: 'total_lessons', type: 'int', default: 0 })
  totalLessons: number;

  @Column({ name: 'total_xp_earned', type: 'int', default: 0 })
  totalXpEarned: number;

  @Column({ name: 'completion_weeks', type: 'int', default: 0 })
  completionWeeks: number;

  @Column({ name: 'next_action', type: 'varchar', nullable: true })
  nextAction: RoadmapNextAction | null;

  @Column({ name: 'coach_rationale', type: 'text', nullable: true })
  coachRationale: string | null;

  @Column({ name: 'coach_ready', type: 'boolean', default: false })
  coachReady: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
