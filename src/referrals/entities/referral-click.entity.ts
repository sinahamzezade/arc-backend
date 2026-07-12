import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ReferralLink } from './referral-link.entity';

@Entity('referral_clicks')
@Index(['referralLinkId', 'createdAt'])
export class ReferralClick {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'referral_link_id', type: 'uuid' })
  referralLinkId: string;

  @ManyToOne(() => ReferralLink, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'referral_link_id' })
  referralLink: ReferralLink;

  @Column({ name: 'is_eligible', type: 'boolean', default: true })
  isEligible: boolean;

  @Column({ name: 'ip_hash', type: 'varchar', length: 64, nullable: true })
  ipHash: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true })
  userAgent: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
