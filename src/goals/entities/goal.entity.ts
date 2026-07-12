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

export enum GoalStatus {
  Active = 'active',
  Archived = 'archived',
  Completed = 'completed',
}

export type ValuesWithOther = {
  values: string[];
  other?: string;
};

export type GoalAvailability = {
  days: string[];
  times: string[];
};

@Entity('goals')
export class Goal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'target_roles', type: 'text', array: true, default: '{}' })
  targetRoles: string[];

  @Column({ type: 'jsonb', default: () => "'{\"values\":[]}'" })
  motivation: ValuesWithOther;

  @Column({ name: 'current_profession', type: 'varchar', nullable: true })
  currentProfession: string | null;

  @Column({
    name: 'current_profession_other',
    type: 'varchar',
    nullable: true,
  })
  currentProfessionOther: string | null;

  @Column({ type: 'jsonb', default: () => "'{\"values\":[]}'" })
  skills: ValuesWithOther;

  @Column({ name: 'weekly_hours', type: 'varchar', nullable: true })
  weeklyHours: string | null;

  @Column({
    type: 'jsonb',
    default: () => "'{\"days\":[],\"times\":[]}'",
  })
  availability: GoalAvailability;

  @Column({ name: 'target_deadline', type: 'varchar', nullable: true })
  targetDeadline: string | null;

  @Column({ name: 'learning_styles', type: 'jsonb', default: () => "'{\"values\":[]}'" })
  learningStyles: ValuesWithOther;

  @Column({ type: 'varchar', nullable: true })
  confidence: string | null;

  @Column({ name: 'quit_reasons', type: 'jsonb', default: () => "'{\"values\":[]}'" })
  quitReasons: ValuesWithOther;

  @Column({ name: 'raw_answers', type: 'jsonb', default: () => "'{}'" })
  rawAnswers: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: GoalStatus,
    default: GoalStatus.Active,
  })
  status: GoalStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
