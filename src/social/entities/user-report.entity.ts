import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum SocialReportContext {
  Profile = 'profile',
  Battle = 'battle',
  StudySession = 'study_session',
  Activity = 'activity',
}

export enum SocialReportReason {
  Spam = 'spam',
  Harassment = 'harassment',
  Cheating = 'cheating',
  Impersonation = 'impersonation',
  Other = 'other',
}

export enum SocialReportStatus {
  Open = 'open',
  Reviewing = 'reviewing',
  Resolved = 'resolved',
  Dismissed = 'dismissed',
}

@Entity('user_reports')
@Index(['reportedUserId', 'status'])
@Index(['reporterId'])
export class UserReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'reporter_id', type: 'uuid' })
  reporterId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reporter_id' })
  reporter: User;

  @Column({ name: 'reported_user_id', type: 'uuid' })
  reportedUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reported_user_id' })
  reportedUser: User;

  @Column({ name: 'context_type', type: 'varchar', length: 32 })
  contextType: SocialReportContext;

  @Column({ name: 'context_id', type: 'uuid', nullable: true })
  contextId: string | null;

  @Column({ type: 'varchar', length: 32 })
  reason: SocialReportReason;

  @Column({ type: 'text', nullable: true })
  details: string | null;

  @Column({
    type: 'varchar',
    length: 16,
    default: SocialReportStatus.Open,
  })
  status: SocialReportStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
