import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('social_counters')
export class SocialCounter {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'friends_count', type: 'int', default: 0 })
  friendsCount: number;

  @Column({ name: 'followers_count', type: 'int', default: 0 })
  followersCount: number;

  @Column({ name: 'following_count', type: 'int', default: 0 })
  followingCount: number;

  @Column({ name: 'battle_wins', type: 'int', default: 0 })
  battleWins: number;

  @Column({ name: 'study_sessions_completed', type: 'int', default: 0 })
  studySessionsCompleted: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
