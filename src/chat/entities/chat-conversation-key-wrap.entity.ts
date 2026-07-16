import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Conversation } from './conversation.entity';

@Entity('chat_conversation_key_wraps')
@Unique(['conversationId', 'userId', 'keyEpoch'])
@Index(['conversationId', 'userId'])
export class ChatConversationKeyWrap {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Sealed conversation key (crypto_box_seal), base64url. */
  @Column({ name: 'wrapped_key', type: 'text' })
  wrappedKey: string;

  @Column({ name: 'key_epoch', type: 'int', default: 1 })
  keyEpoch: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
