import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import {
  StudyInvitationStatus,
  StudyParticipantRole,
} from '../study.constants';
import { StudySession } from './study-session.entity';

@Entity('study_session_participants')
@Unique(['sessionId', 'userId'])
@Index(['userId', 'invitationStatus'])
export class StudySessionParticipant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId: string;

  @ManyToOne(() => StudySession, (s) => s.participants, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'session_id' })
  session: StudySession;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 16 })
  role: StudyParticipantRole;

  @Column({
    name: 'invitation_status',
    type: 'varchar',
    length: 24,
    default: StudyInvitationStatus.Pending,
  })
  invitationStatus: StudyInvitationStatus;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId: string | null;

  @Column({ name: 'task_label', type: 'varchar', length: 120, nullable: true })
  taskLabel: string | null;

  @Column({ name: 'acked_step', type: 'int', default: -1 })
  ackedStep: number;

  @Column({ name: 'typing_at', type: 'timestamptz', nullable: true })
  typingAt: Date | null;

  /** Watermark: partner has read chat through this timestamp. */
  @Column({ name: 'chat_last_read_at', type: 'timestamptz', nullable: true })
  chatLastReadAt: Date | null;

  @Column({ name: 'joined_at', type: 'timestamptz', nullable: true })
  joinedAt: Date | null;

  @Column({ name: 'left_at', type: 'timestamptz', nullable: true })
  leftAt: Date | null;

  @Column({ name: 'ready_at', type: 'timestamptz', nullable: true })
  readyAt: Date | null;

  @Column({ name: 'verified_active_seconds', type: 'int', default: 0 })
  verifiedActiveSeconds: number;

  @Column({ name: 'heartbeat_count', type: 'int', default: 0 })
  heartbeatCount: number;

  @Column({ name: 'last_heartbeat_at', type: 'timestamptz', nullable: true })
  lastHeartbeatAt: Date | null;

  @Column({ name: 'app_visible', type: 'boolean', default: true })
  appVisible: boolean;

  @Column({ name: 'meaningful_action_completed', type: 'boolean', default: false })
  meaningfulActionCompleted: boolean;

  @Column({ name: 'completion_confirmed', type: 'boolean', default: false })
  completionConfirmed: boolean;

  @Column({ name: 'qualified', type: 'boolean', default: false })
  qualified: boolean;

  @Column({ name: 'reward_eligible', type: 'boolean', default: false })
  rewardEligible: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
