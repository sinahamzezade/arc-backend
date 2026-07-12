import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Goal } from '../../goals/entities/goal.entity';
import type { QuestionnaireAnswers } from '../types/answers';

export enum QuestionnaireResponseStatus {
  Draft = 'draft',
  Submitted = 'submitted',
}

@Entity('questionnaire_responses')
export class QuestionnaireResponse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    type: 'enum',
    enum: QuestionnaireResponseStatus,
    default: QuestionnaireResponseStatus.Draft,
  })
  status: QuestionnaireResponseStatus;

  @Column({ type: 'jsonb' })
  answers: QuestionnaireAnswers;

  @Column({ name: 'schema_version', type: 'int', default: 1 })
  schemaVersion: number;

  @Column({ name: 'goal_id', type: 'uuid', nullable: true })
  goalId: string | null;

  @ManyToOne(() => Goal, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'goal_id' })
  goal: Goal | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
