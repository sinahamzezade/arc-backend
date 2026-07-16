import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { StudySession } from './study-session.entity';

export type StudyMessageKind = 'text' | 'voice' | 'image';

@Entity('study_session_messages')
@Index(['sessionId', 'createdAt'])
export class StudySessionMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId: string;

  @ManyToOne(() => StudySession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: StudySession;

  @Column({ name: 'sender_id', type: 'uuid' })
  senderId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sender_id' })
  sender: User;

  /** text | voice | image */
  @Column({ type: 'varchar', length: 16, default: 'text' })
  kind: StudyMessageKind;

  /** Caption for media, or full text for kind=text. Empty string OK for media. */
  @Column({ type: 'varchar', length: 500, default: '' })
  body: string;

  @Column({ name: 'media_key', type: 'varchar', length: 191, nullable: true })
  mediaKey: string | null;

  @Column({ name: 'media_mime', type: 'varchar', length: 64, nullable: true })
  mediaMime: string | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
