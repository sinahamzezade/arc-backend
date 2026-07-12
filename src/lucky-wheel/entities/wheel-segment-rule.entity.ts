import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WheelCampaign } from './wheel-campaign.entity';
import { WheelRewardType } from './wheel.enums';

@Entity('wheel_segment_rules')
@Index(['campaignId', 'rewardKey'])
export class WheelSegmentRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'campaign_id', type: 'uuid' })
  campaignId: string;

  @ManyToOne(() => WheelCampaign, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign: WheelCampaign;

  @Column({ name: 'reward_key', type: 'varchar', length: 64 })
  rewardKey: string;

  @Column({ name: 'reward_type', type: 'enum', enum: WheelRewardType })
  rewardType: WheelRewardType;

  @Column({ name: 'reward_payload', type: 'jsonb', default: () => "'{}'" })
  rewardPayload: Record<string, unknown>;

  @Column({ type: 'numeric', precision: 10, scale: 4, default: 1 })
  weight: string;

  @Column({ name: 'min_rank_level', type: 'int', nullable: true })
  minRankLevel: number | null;

  @Column({ name: 'max_rank_level', type: 'int', nullable: true })
  maxRankLevel: number | null;

  @Column({ name: 'daily_global_limit', type: 'int', nullable: true })
  dailyGlobalLimit: number | null;

  @Column({ name: 'total_inventory', type: 'int', nullable: true })
  totalInventory: number | null;

  @Column({
    name: 'replacement_reward_key',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  replacementRewardKey: string | null;

  @Column({ name: 'allow_duplicate_on_layout', type: 'boolean', default: true })
  allowDuplicateOnLayout: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
