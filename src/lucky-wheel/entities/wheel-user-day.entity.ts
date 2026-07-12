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
import { WheelCampaign } from './wheel-campaign.entity';

export type LayoutSegmentSnapshot = {
  id: string;
  rewardKey: string;
  rewardType: string;
  label: string;
  amount: number;
  weight: number;
  color: string;
  payload: Record<string, unknown>;
  fallbackRewardKey?: string;
};

@Entity('wheel_user_days')
@Unique(['userId', 'campaignId', 'rewardDay'])
@Index(['userId', 'rewardDay'])
export class WheelUserDay {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'campaign_id', type: 'uuid' })
  campaignId: string;

  @ManyToOne(() => WheelCampaign, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign: WheelCampaign;

  @Column({ name: 'reward_day', type: 'date' })
  rewardDay: string;

  @Column({ name: 'day_start_at', type: 'timestamptz' })
  dayStartAt: Date;

  @Column({ name: 'day_end_at', type: 'timestamptz' })
  dayEndAt: Date;

  @Column({ name: 'layout_snapshot', type: 'jsonb', default: () => "'[]'" })
  layoutSnapshot: LayoutSegmentSnapshot[];

  @Column({ name: 'free_spins_total', type: 'int', default: 1 })
  freeSpinsTotal: number;

  @Column({ name: 'paid_spins_total', type: 'int', default: 0 })
  paidSpinsTotal: number;

  @Column({ name: 'extra_spins_total', type: 'int', default: 0 })
  extraSpinsTotal: number;

  @Column({ name: 'spins_used', type: 'int', default: 0 })
  spinsUsed: number;

  @Column({ name: 'gems_awarded_today', type: 'int', default: 0 })
  gemsAwardedToday: number;

  @Column({ name: 'xp_awarded_today', type: 'int', default: 0 })
  xpAwardedToday: number;

  @Column({ name: 'next_spin_at', type: 'timestamptz', nullable: true })
  nextSpinAt: Date | null;

  @Column({ name: 'layout_version', type: 'int', default: 1 })
  layoutVersion: number;

  @Column({ name: 'timezone_snapshot', type: 'varchar', length: 64 })
  timezoneSnapshot: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
