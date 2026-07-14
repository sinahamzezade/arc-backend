import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum QuestionnaireStatus {
  NotStarted = 'not_started',
  InProgress = 'in_progress',
  Completed = 'completed',
}

@Entity('profiles')
export class Profile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @OneToOne(() => User, (user) => user.profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'display_name', type: 'varchar', nullable: true })
  displayName: string | null;

  @Column({ type: 'varchar', unique: true, nullable: true })
  username: string | null;

  @Column({ name: 'avatar_url', type: 'varchar', nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  timezone: string | null;

  @Column({ type: 'varchar', default: 'en' })
  language: string;

  @Column({ name: 'current_rank', type: 'varchar', nullable: true })
  currentRank: string | null;

  @Column({ name: 'total_xp', type: 'int', default: 0 })
  totalXp: number;

  @Column({ type: 'int', default: 0 })
  coins: number;

  @Column({ type: 'int', default: 0 })
  gems: number;

  @Column({ name: 'weekly_streak', type: 'int', default: 0 })
  weeklyStreak: number;

  /** User intake preference: form | chat. Null = use INTAKE_DEFAULT_MODE. */
  @Column({ name: 'intake_mode', type: 'varchar', length: 16, nullable: true })
  intakeMode: 'form' | 'chat' | null;

  @Column({
    name: 'questionnaire_status',
    type: 'enum',
    enum: QuestionnaireStatus,
    default: QuestionnaireStatus.NotStarted,
  })
  questionnaireStatus: QuestionnaireStatus;

  @Column({
    name: 'questionnaire_completed_at',
    type: 'timestamptz',
    nullable: true,
  })
  questionnaireCompletedAt: Date | null;

  @Column({
    name: 'onboarding_completed_at',
    type: 'timestamptz',
    nullable: true,
  })
  onboardingCompletedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
