import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { ReferralShareChannel } from '../referral.constants';
import { ReferralLink } from './referral-link.entity';

@Entity('referral_share_events')
@Unique(['userId', 'clientEventId'])
@Index(['referralLinkId', 'createdAt'])
export class ReferralShareEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'referral_link_id', type: 'uuid' })
  referralLinkId: string;

  @ManyToOne(() => ReferralLink, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'referral_link_id' })
  referralLink: ReferralLink;

  @Column({ name: 'client_event_id', type: 'varchar', length: 64 })
  clientEventId: string;

  @Column({ name: 'event_type', type: 'varchar', length: 64 })
  eventType: string;

  @Column({
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  channel: ReferralShareChannel | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
