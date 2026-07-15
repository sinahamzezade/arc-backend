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
import {
  StudyCompletionOutcome,
  StudySessionMode,
  StudySessionStatus,
  StudyStartMode,
} from '../study.constants';
import { StudySessionParticipant } from './study-session-participant.entity';

@Entity('study_sessions')
@Index(['creatorId', 'status'])
@Index(['inviteeId', 'status'])
@Index(['status', 'inviteExpiresAt'])
export class StudySession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'creator_id', type: 'uuid' })
  creatorId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'creator_id' })
  creator: User;

  @Column({ name: 'invitee_id', type: 'uuid' })
  inviteeId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invitee_id' })
  invitee: User;

  @Column({ type: 'varchar', length: 64 })
  subject: string;

  @Column({ name: 'lesson_id', type: 'uuid', nullable: true })
  lessonId: string | null;

  @Column({ name: 'unit_id', type: 'varchar', nullable: true })
  unitId: string | null;

  @Column({ name: 'lesson_title', type: 'varchar', length: 200, nullable: true })
  lessonTitle: string | null;

  @Column({
    type: 'varchar',
    length: 24,
    default: StudySessionMode.ReadTogether,
  })
  mode: StudySessionMode;

  @Column({ name: 'content_step', type: 'int', default: 0 })
  contentStep: number;

  @Column({ name: 'step_count', type: 'int', default: 0 })
  stepCount: number;

  @Column({ name: 'duration_minutes', type: 'int' })
  durationMinutes: number;

  @Column({ name: 'start_mode', type: 'varchar', length: 24 })
  startMode: StudyStartMode;

  @Column({ name: 'message', type: 'varchar', length: 160, nullable: true })
  message: string | null;

  @Column({ type: 'varchar', length: 32, default: StudySessionStatus.Draft })
  status: StudySessionStatus;

  @Column({ name: 'scheduled_start_at', type: 'timestamptz', nullable: true })
  scheduledStartAt: Date | null;

  @Column({ name: 'scheduled_end_at', type: 'timestamptz', nullable: true })
  scheduledEndAt: Date | null;

  @Column({ name: 'invite_expires_at', type: 'timestamptz', nullable: true })
  inviteExpiresAt: Date | null;

  @Column({ name: 'actual_start_at', type: 'timestamptz', nullable: true })
  actualStartAt: Date | null;

  @Column({ name: 'actual_end_at', type: 'timestamptz', nullable: true })
  actualEndAt: Date | null;

  @Column({ name: 'planned_end_at', type: 'timestamptz', nullable: true })
  plannedEndAt: Date | null;

  @Column({ name: 'room_version', type: 'int', default: 1 })
  roomVersion: number;

  @Column({
    name: 'completion_outcome',
    type: 'varchar',
    length: 40,
    default: StudyCompletionOutcome.None,
  })
  completionOutcome: StudyCompletionOutcome;

  @Column({
    name: 'reward_transaction_group',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  rewardTransactionGroup: string | null;

  @Column({ name: 'shared_bonus_granted', type: 'boolean', default: false })
  sharedBonusGranted: boolean;

  @OneToMany(() => StudySessionParticipant, (p) => p.session)
  participants: StudySessionParticipant[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
