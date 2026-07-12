import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type RankGateRule = {
  type: string;
  gte?: number;
  key?: string;
};

export type RankGateRules = {
  all?: RankGateRule[];
};

export type RankRewardConfig = {
  coins?: number;
  gems?: number;
  badgeId?: string;
  badgeLabel?: string;
  frameSku?: string;
  frameLabel?: string;
};

@Entity('rank_definitions')
export class RankDefinition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'int' })
  level: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  slug: string;

  @Column({ type: 'varchar', length: 128 })
  title: string;

  @Column({ name: 'xp_threshold', type: 'int', default: 0 })
  xpThreshold: number;

  @Column({ name: 'minimum_active_days', type: 'int', default: 0 })
  minimumActiveDays: number;

  @Column({ name: 'gate_rules', type: 'jsonb', default: () => "'{\"all\":[]}'" })
  gateRules: RankGateRules;

  @Column({ name: 'reward_config', type: 'jsonb', default: () => "'{}'" })
  rewardConfig: RankRewardConfig;

  @Column({ name: 'icon_asset_key', type: 'varchar', length: 128, nullable: true })
  iconAssetKey: string | null;

  @Column({ name: 'display_order', type: 'int', default: 0 })
  displayOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 1 })
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
