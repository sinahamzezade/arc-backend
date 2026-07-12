import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('rank_progress_requirements')
@Unique(['userId', 'rankLevel', 'requirementKey'])
export class RankProgressRequirement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'rank_level', type: 'int' })
  rankLevel: number;

  @Column({ name: 'requirement_key', type: 'varchar', length: 64 })
  requirementKey: string;

  @Column({ name: 'required_value', type: 'int', default: 0 })
  requiredValue: number;

  @Column({ name: 'current_value', type: 'int', default: 0 })
  currentValue: number;

  @Column({ type: 'boolean', default: false })
  complete: boolean;

  @Column({ name: 'source_ids', type: 'jsonb', default: () => "'[]'" })
  sourceIds: string[];

  @Column({ name: 'evaluated_at', type: 'timestamptz', nullable: true })
  evaluatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
