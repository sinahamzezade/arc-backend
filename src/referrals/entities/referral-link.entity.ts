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
import { User } from '../../users/entities/user.entity';
import {
  ReferralLinkStatus,
  ReferralShareChannel,
} from '../referral.constants';
import { ReferralCode } from './referral-code.entity';

@Entity('referral_links')
@Index(['ownerUserId', 'status'])
@Index(['publicToken'], { unique: true })
export class ReferralLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_user_id' })
  owner: User;

  @Column({ name: 'referral_code_id', type: 'uuid' })
  referralCodeId: string;

  @ManyToOne(() => ReferralCode, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'referral_code_id' })
  referralCode: ReferralCode;

  @Column({ name: 'public_token', type: 'varchar', length: 48 })
  publicToken: string;

  @Column({ type: 'varchar', length: 24, default: ReferralShareChannel.CopyLink })
  channel: ReferralShareChannel;

  @Column({ type: 'varchar', length: 64, default: 'friends_hub' })
  campaign: string;

  @Column({ type: 'varchar', length: 8, default: 'en' })
  locale: string;

  @Column({ type: 'varchar', length: 16, default: ReferralLinkStatus.Active })
  status: ReferralLinkStatus;

  @Column({ name: 'click_count', type: 'int', default: 0 })
  clickCount: number;

  @Column({ name: 'signup_count', type: 'int', default: 0 })
  signupCount: number;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
