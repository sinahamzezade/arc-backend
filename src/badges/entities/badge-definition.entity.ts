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
  BadgeCategory,
  BadgeCriteriaType,
  BadgeDefinitionStatus,
  BadgeRarity,
} from '../badge.constants';
import type {
  BadgeCriteriaJson,
  BadgeRewardJson,
} from '../badge.constants';

@Entity('badge_definitions')
@Unique(['code'])
export class BadgeDefinition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  code: string;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ name: 'name_key', type: 'varchar', length: 120 })
  nameKey: string;

  @Column({ name: 'description_key', type: 'varchar', length: 240 })
  descriptionKey: string;

  /** Display name (English snapshot for MVP). */
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 280 })
  description: string;

  @Column({ type: 'varchar', length: 32 })
  category: BadgeCategory;

  @Column({ type: 'varchar', length: 24 })
  rarity: BadgeRarity;

  @Column({ name: 'icon_asset_key', type: 'varchar', length: 255, nullable: true })
  iconAssetKey: string | null;

  @Column({ name: 'is_hidden', type: 'boolean', default: false })
  isHidden: boolean;

  @Column({ name: 'is_seasonal', type: 'boolean', default: false })
  isSeasonal: boolean;

  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt: Date | null;

  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
  endsAt: Date | null;

  @Column({ type: 'varchar', length: 16, default: BadgeDefinitionStatus.Active })
  status: BadgeDefinitionStatus;

  @Column({ name: 'criteria_type', type: 'varchar', length: 40 })
  criteriaType: BadgeCriteriaType;

  @Column({ name: 'criteria_json', type: 'jsonb' })
  criteriaJson: BadgeCriteriaJson;

  @Column({ name: 'reward_json', type: 'jsonb', default: {} })
  rewardJson: BadgeRewardJson;

  @Index()
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
