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

@Entity('friendships')
@Index(['userLowId'])
@Index(['userHighId'])
@Index(['userLowId', 'userHighId'])
export class Friendship {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Lexicographically lower user id — keeps undirected edge unique. */
  @Column({ name: 'user_low_id', type: 'uuid' })
  userLowId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_low_id' })
  userLow: User;

  @Column({ name: 'user_high_id', type: 'uuid' })
  userHighId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_high_id' })
  userHigh: User;

  @Column({ name: 'created_from_request_id', type: 'uuid', nullable: true })
  createdFromRequestId: string | null;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

export function friendshipPair(
  a: string,
  b: string,
): { userLowId: string; userHighId: string } {
  return a < b
    ? { userLowId: a, userHighId: b }
    : { userLowId: b, userHighId: a };
}
