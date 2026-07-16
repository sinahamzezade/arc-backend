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
import { StudyPathStatus } from '../study.constants';

@Entity('study_paths')
@Index(['creatorId', 'status'])
@Index(['partnerId', 'status'])
@Index(['stack', 'status'])
export class StudyPath {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'creator_id', type: 'uuid' })
  creatorId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'creator_id' })
  creator: User;

  @Column({ name: 'partner_id', type: 'uuid' })
  partnerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'partner_id' })
  partner: User;

  /** Content-pool stack slug — co-roadmap identity (e.g. digital-marketing). */
  @Column({ type: 'varchar' })
  stack: string;

  /** Creator's current reading lesson for the active stack unit. */
  @Column({ name: 'creator_lesson_id', type: 'uuid' })
  creatorLessonId: string;

  /** Hub grouping — usually Unit.domain at create. */
  @Column({ type: 'varchar', length: 64, default: 'general' })
  category: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({
    type: 'varchar',
    length: 24,
    default: StudyPathStatus.Invited,
  })
  status: StudyPathStatus;

  /** Index of current reading unit within the stack (0-based). */
  @Column({ name: 'content_step', type: 'int', default: 0 })
  contentStep: number;

  /** Number of reading units in the stack. */
  @Column({ name: 'step_count', type: 'int', default: 0 })
  stepCount: number;

  @Column({ name: 'progress_percent', type: 'int', default: 0 })
  progressPercent: number;

  @Column({ name: 'invite_message', type: 'varchar', length: 160, nullable: true })
  inviteMessage: string | null;

  @Column({ name: 'invite_expires_at', type: 'timestamptz', nullable: true })
  inviteExpiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
