import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('user_badge_progress')
@Unique(['userId', 'badgeCode'])
export class UserBadgeProgress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'badge_code', type: 'varchar', length: 64 })
  badgeCode: string;

  @Column({ name: 'current_value', type: 'int', default: 0 })
  currentValue: number;

  @Column({ name: 'target_value', type: 'int', default: 1 })
  targetValue: number;

  @Column({ name: 'progress_percent', type: 'int', default: 0 })
  progressPercent: number;

  @Column({ name: 'progress_json', type: 'jsonb', nullable: true })
  progressJson: Record<string, unknown> | null;

  @Column({ name: 'last_event_id', type: 'uuid', nullable: true })
  lastEventId: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
