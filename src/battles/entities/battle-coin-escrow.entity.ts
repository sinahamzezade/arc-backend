import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { BattleEscrowStatus } from '../battle.constants';
import { Battle } from './battle.entity';

@Entity('battle_coin_escrows')
@Unique(['battleId', 'userId'])
@Index(['battleId', 'status'])
export class BattleCoinEscrow {
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

  @Column({ type: 'int' })
  amount: number;

  @Column({ name: 'debit_ledger_entry_id', type: 'uuid', nullable: true })
  debitLedgerEntryId: string | null;

  @Column({ type: 'varchar', length: 16, default: BattleEscrowStatus.Reserved })
  status: BattleEscrowStatus;

  @Column({ name: 'settlement_transaction_id', type: 'uuid', nullable: true })
  settlementTransactionId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
