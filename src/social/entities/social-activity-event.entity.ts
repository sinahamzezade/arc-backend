import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum SocialActivityEventType {
  RankUnlocked = 'rank_unlocked',
  BadgeUnlocked = 'badge_unlocked',
  QuestCompleted = 'quest_completed',
  ProjectCompleted = 'project_completed',
  BattleWon = 'battle_won',
  StudyPartnerCreated = 'study_partner_created',
}

export enum SocialActivityVisibility {
  Public = 'public',
  Followers = 'followers',
  Friends = 'friends',
  Private = 'private',
}

@Entity('social_activity_events')
@Index(['actorId', 'createdAt'])
@Index(['visibility', 'createdAt'])
export class SocialActivityEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'actor_id', type: 'uuid' })
  actorId: string;

  @Column({ name: 'event_type', type: 'varchar', length: 32 })
  eventType: SocialActivityEventType;

  @Column({ name: 'entity_type', type: 'varchar', length: 32, nullable: true })
  entityType: string | null;

  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId: string | null;

  @Column({
    type: 'varchar',
    length: 16,
    default: SocialActivityVisibility.Friends,
  })
  visibility: SocialActivityVisibility;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  payload: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
