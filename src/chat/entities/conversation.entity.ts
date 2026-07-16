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
import { ConversationType } from '../chat.constants';
import { ConversationMember } from './conversation-member.entity';
import { ChatMessage } from './chat-message.entity';

@Entity('conversations')
@Index(['lastMessageAt'])
@Index(['type', 'directPairKey'], {
  unique: true,
  where: `"type" = 'direct' AND "direct_pair_key" IS NOT NULL`,
})
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16 })
  type: ConversationType;

  @Column({ type: 'varchar', length: 120, nullable: true })
  title: string | null;

  @Column({ name: 'avatar_url', type: 'varchar', length: 512, nullable: true })
  avatarUrl: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'created_by' })
  creator: User;

  /** Sorted userA_userB for direct DMs; null for groups. */
  @Column({ name: 'direct_pair_key', type: 'varchar', length: 80, nullable: true })
  directPairKey: string | null;

  @Column({ name: 'last_message_at', type: 'timestamptz', nullable: true })
  lastMessageAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => ConversationMember, (m) => m.conversation)
  members: ConversationMember[];

  @OneToMany(() => ChatMessage, (m) => m.conversation)
  messages: ChatMessage[];
}
