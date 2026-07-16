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
import { ChatReportReason, ChatReportStatus } from '../chat.constants';
import { ChatMessage } from './chat-message.entity';

@Entity('chat_reports')
@Index(['status', 'createdAt'])
@Index(['reason', 'status'])
export class ChatReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'reporter_id', type: 'uuid' })
  reporterId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reporter_id' })
  reporter: User;

  @Column({ name: 'message_id', type: 'uuid', nullable: true })
  messageId: string | null;

  @ManyToOne(() => ChatMessage, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'message_id' })
  message: ChatMessage | null;

  @Column({ name: 'reported_user_id', type: 'uuid' })
  reportedUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reported_user_id' })
  reportedUser: User;

  @Column({ type: 'varchar', length: 32 })
  reason: ChatReportReason;

  @Column({ type: 'text', nullable: true })
  detail: string | null;

  @Column({
    type: 'varchar',
    length: 16,
    default: ChatReportStatus.Open,
  })
  status: ChatReportStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
