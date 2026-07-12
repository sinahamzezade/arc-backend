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

@Entity('badge_unlock_events')
@Index(['userId', 'badgeCode', 'createdAt'])
export class BadgeUnlockEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'badge_code', type: 'varchar', length: 64 })
  badgeCode: string;

  @Column({ name: 'source_event_id', type: 'varchar', length: 80, nullable: true })
  sourceEventId: string | null;

  @Column({ name: 'source_event_type', type: 'varchar', length: 80, nullable: true })
  sourceEventType: string | null;

  @Column({ name: 'result', type: 'varchar', length: 24 })
  result: 'unlocked' | 'progress' | 'skipped' | 'already';

  @Column({ type: 'varchar', length: 200, nullable: true })
  reason: string | null;

  @Column({ type: 'jsonb', nullable: true })
  snapshot: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
