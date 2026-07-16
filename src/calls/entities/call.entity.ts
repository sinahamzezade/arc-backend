import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Conversation } from '../../chat/entities/conversation.entity';
import { CallEndReason, CallMode, CallState } from '../call.constants';

@Entity('calls')
@Index(['callerId', 'createdAt'])
@Index(['calleeId', 'createdAt'])
@Index(['conversationId', 'createdAt'])
export class Call {
  /** Client-generated callId (idempotent invites). */
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @Column({ name: 'caller_id', type: 'uuid' })
  callerId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'caller_id' })
  caller: User;

  @Column({ name: 'callee_id', type: 'uuid' })
  calleeId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'callee_id' })
  callee: User;

  @Column({ type: 'varchar', length: 16 })
  mode: CallMode;

  @Column({ type: 'varchar', length: 16 })
  state: CallState;

  @Column({ name: 'end_reason', type: 'varchar', length: 16, nullable: true })
  endReason: CallEndReason | null;

  @Column({ name: 'used_turn', type: 'boolean', default: false })
  usedTurn: boolean;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Column({ name: 'duration_sec', type: 'int', nullable: true })
  durationSec: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
