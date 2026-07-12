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
import { Battle } from './battle.entity';

@Entity('battle_results')
@Unique(['battleId', 'userId'])
@Index(['userId', 'createdAt'])
export class BattleResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'battle_id', type: 'uuid' })
  battleId: string;

  @ManyToOne(() => Battle, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'battle_id' })
  battle: Battle;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'opponent_id', type: 'uuid' })
  opponentId: string;

  @Column({ name: 'opponent_display_name', type: 'varchar', length: 80 })
  opponentDisplayName: string;

  @Column({ type: 'varchar', length: 64 })
  subject: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  topic: string | null;

  @Column({ type: 'varchar', length: 16 })
  result: 'win' | 'loss' | 'draw';

  @Column({ name: 'your_score', type: 'int' })
  yourScore: number;

  @Column({ name: 'their_score', type: 'int' })
  theirScore: number;

  @Column({ name: 'stake_per_player', type: 'int' })
  stakePerPlayer: number;

  @Column({ name: 'coins_delta', type: 'int' })
  coinsDelta: number;

  @Column({ type: 'int', default: 0 })
  accuracy: number;

  @Column({ name: 'avg_answer_ms', type: 'int', default: 0 })
  avgAnswerMs: number;

  @Column({ name: 'xp_awarded', type: 'int', default: 0 })
  xpAwarded: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
