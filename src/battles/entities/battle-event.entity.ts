import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BattleEventType } from '../battle.constants';
import { Battle } from './battle.entity';

@Entity('battle_events')
@Index(['battleId', 'sequence'])
export class BattleEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'battle_id', type: 'uuid' })
  battleId: string;

  @ManyToOne(() => Battle, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'battle_id' })
  battle: Battle;

  @Column({ type: 'bigint' })
  sequence: string;

  @Column({ type: 'varchar', length: 32 })
  type: BattleEventType;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  payload: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
