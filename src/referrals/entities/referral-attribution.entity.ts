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
import { ReferralAttributionStatus } from '../referral.constants';
import { ReferralCode } from './referral-code.entity';
import { ReferralLink } from './referral-link.entity';

@Entity('referral_attributions')
@Unique(['inviteeUserId'])
@Index(['inviterUserId', 'status'])
export class ReferralAttribution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'inviter_user_id', type: 'uuid' })
  inviterUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inviter_user_id' })
  inviter: User;

  @Column({ name: 'invitee_user_id', type: 'uuid' })
  inviteeUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'invitee_user_id' })
  invitee: User;

  @Column({ name: 'referral_code_id', type: 'uuid', nullable: true })
  referralCodeId: string | null;

  @ManyToOne(() => ReferralCode, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'referral_code_id' })
  referralCode: ReferralCode | null;

  @Column({ name: 'referral_link_id', type: 'uuid', nullable: true })
  referralLinkId: string | null;

  @ManyToOne(() => ReferralLink, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'referral_link_id' })
  referralLink: ReferralLink | null;

  @Column({
    type: 'varchar',
    length: 32,
    default: ReferralAttributionStatus.Registered,
  })
  status: ReferralAttributionStatus;

  @Column({ name: 'qualified_at', type: 'timestamptz', nullable: true })
  qualifiedAt: Date | null;

  @Column({ name: 'rewarded_at', type: 'timestamptz', nullable: true })
  rewardedAt: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
