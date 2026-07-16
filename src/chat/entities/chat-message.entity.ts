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
import { ChatMessageType } from '../chat.constants';
import { Conversation } from './conversation.entity';
import { ChatAttachment } from './chat-attachment.entity';

@Entity('chat_messages')
@Index(['conversationId', 'createdAt', 'id'])
@Index(['conversationId', 'senderId', 'clientMsgId'], { unique: true })
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @ManyToOne(() => Conversation, (c) => c.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @Column({ name: 'sender_id', type: 'uuid' })
  senderId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sender_id' })
  sender: User;

  @Column({ name: 'client_msg_id', type: 'uuid' })
  clientMsgId: string;

  @Column({ type: 'varchar', length: 16, default: ChatMessageType.Text })
  type: ChatMessageType;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ name: 'attachment_id', type: 'uuid', nullable: true })
  attachmentId: string | null;

  @ManyToOne(() => ChatAttachment, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'attachment_id' })
  attachment: ChatAttachment | null;

  @Column({ name: 'reply_to_id', type: 'uuid', nullable: true })
  replyToId: string | null;

  @ManyToOne(() => ChatMessage, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'reply_to_id' })
  replyTo: ChatMessage | null;

  @Column({ name: 'edited_at', type: 'timestamptz', nullable: true })
  editedAt: Date | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
