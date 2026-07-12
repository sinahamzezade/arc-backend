import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ReferralRiskStatus {
  Open = 'open',
  Held = 'held',
  Cleared = 'cleared',
  Rejected = 'rejected',
}

@Entity('referral_risk_reviews')
@Index(['attributionId'])
@Index(['status'])
export class ReferralRiskReview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'attribution_id', type: 'uuid' })
  attributionId: string;

  @Column({ name: 'inviter_user_id', type: 'uuid' })
  inviterUserId: string;

  @Column({ name: 'invitee_user_id', type: 'uuid' })
  inviteeUserId: string;

  @Column({ type: 'varchar', length: 16, default: ReferralRiskStatus.Open })
  status: ReferralRiskStatus;

  @Column({ name: 'reason_codes', type: 'jsonb', default: () => "'[]'" })
  reasonCodes: string[];

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
