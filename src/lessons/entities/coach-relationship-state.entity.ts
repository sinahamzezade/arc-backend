import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export type CoachTone =
  | 'encouraging'
  | 'playful'
  | 'steady'
  | 'welcome_back';

@Entity('coach_relationship_state')
export class CoachRelationshipState {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Bounded rapport; floor at neutral (0). Never punitive below 0. */
  @Column({ name: 'rapport_score', type: 'int', default: 0 })
  rapportScore: number;

  @Column({ name: 'last_tone', type: 'varchar', default: 'steady' })
  lastTone: CoachTone;

  @Column({ name: 'running_jokes', type: 'jsonb', default: () => "'[]'" })
  runningJokes: unknown[];

  @Column({ name: 'last_active_at', type: 'timestamptz', nullable: true })
  lastActiveAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
