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
import { UserBadgeStatus } from '../badge.constants';
import { BadgeDefinition } from './badge-definition.entity';

/**
 * Earned badge row. Keeps legacy `badge_id` / `badge_label` columns so
 * lessons/ranks/wheel/referrals writers stay compatible.
 */
@Entity('user_badges')
@Unique(['userId', 'badgeId'])
export class UserBadge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Stable badge code (doc `badge_code`). */
  @Column({ name: 'badge_id', type: 'varchar', length: 64 })
  badgeId: string;

  @Column({ name: 'badge_label', type: 'varchar', length: 120 })
  badgeLabel: string;

  @Column({ name: 'badge_definition_id', type: 'uuid', nullable: true })
  badgeDefinitionId: string | null;

  @ManyToOne(() => BadgeDefinition, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'badge_definition_id' })
  badgeDefinition: BadgeDefinition | null;

  @Column({ name: 'badge_version', type: 'int', nullable: true })
  badgeVersion: number | null;

  @Column({
    type: 'varchar',
    length: 16,
    default: UserBadgeStatus.Earned,
  })
  status: UserBadgeStatus;

  @CreateDateColumn({ name: 'unlocked_at', type: 'timestamptz' })
  unlockedAt: Date;

  @Column({ name: 'earned_at', type: 'timestamptz', nullable: true })
  earnedAt: Date | null;

  @Column({ name: 'source_event_id', type: 'uuid', nullable: true })
  sourceEventId: string | null;

  @Column({ name: 'source_entity_type', type: 'varchar', length: 40, nullable: true })
  sourceEntityType: string | null;

  @Column({ name: 'source_entity_id', type: 'uuid', nullable: true })
  sourceEntityId: string | null;

  @Column({
    name: 'reward_transaction_group_id',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  rewardTransactionGroupId: string | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, unknown> | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'revocation_reason', type: 'varchar', length: 200, nullable: true })
  revocationReason: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
