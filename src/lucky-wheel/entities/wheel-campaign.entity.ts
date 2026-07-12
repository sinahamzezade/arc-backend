import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  WheelCampaignStatus,
  WheelTimezonePolicy,
} from './wheel.enums';

@Entity('wheel_campaigns')
export class WheelCampaign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  slug: string;

  @Column({
    type: 'enum',
    enum: WheelCampaignStatus,
    default: WheelCampaignStatus.Draft,
  })
  status: WheelCampaignStatus;

  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt: Date | null;

  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
  endsAt: Date | null;

  @Column({
    name: 'timezone_policy',
    type: 'enum',
    enum: WheelTimezonePolicy,
    default: WheelTimezonePolicy.UserLocal,
  })
  timezonePolicy: WheelTimezonePolicy;

  @Column({ name: 'segment_count', type: 'int', default: 6 })
  segmentCount: number;

  @Column({ name: 'max_free_spins_per_day', type: 'int', default: 1 })
  maxFreeSpinsPerDay: number;

  @Column({ name: 'max_paid_respins_per_day', type: 'int', default: 1 })
  maxPaidRespinsPerDay: number;

  @Column({ name: 'respin_gem_price', type: 'int', default: 25 })
  respinGemPrice: number;

  @Column({ name: 'eligibility_rules', type: 'jsonb', default: () => "'{}'" })
  eligibilityRules: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
