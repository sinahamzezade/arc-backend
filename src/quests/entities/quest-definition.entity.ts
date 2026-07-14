import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import {
  QuestCadence,
  QuestCategory,
  QuestConditionType,
  QuestDefinitionStatus,
  type QuestConditionJson,
  type QuestRewardJson,
} from '../quest.constants';

@Entity('quest_definitions')
@Unique(['code'])
export class QuestDefinition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  code: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 280, default: '' })
  description: string;

  /** Longer instructional copy shown under the title. */
  @Column({ type: 'varchar', length: 480, default: '' })
  detail: string;

  @Column({ type: 'varchar', length: 24 })
  cadence: QuestCadence;

  @Column({ type: 'varchar', length: 32 })
  category: QuestCategory;

  @Column({ type: 'varchar', length: 16, default: QuestDefinitionStatus.Draft })
  status: QuestDefinitionStatus;

  @Column({ name: 'condition_type', type: 'varchar', length: 40 })
  conditionType: QuestConditionType;

  @Column({ name: 'condition_json', type: 'jsonb' })
  conditionJson: QuestConditionJson;

  @Column({ name: 'reward_json', type: 'jsonb', default: {} })
  rewardJson: QuestRewardJson;

  @Index()
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  /** Side / optional quests do not block required progress. */
  @Column({ name: 'is_optional', type: 'boolean', default: false })
  isOptional: boolean;

  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt: Date | null;

  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
  endsAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
