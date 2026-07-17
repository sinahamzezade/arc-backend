import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Curated current-events snippets — outside the authoring graph / compiled units.
 * Never AI-invented; omitted at play time when expired or inactive.
 */
@Entity('live_context_snippets')
export class LiveContextSnippet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Matches a domain/stack value (e.g. frontend, digital-marketing). */
  @Column({ name: 'track_tag', type: 'varchar' })
  trackTag: string;

  @Column({ type: 'varchar' })
  headline: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ name: 'source_url', type: 'text', nullable: true })
  sourceUrl: string | null;

  @Column({ name: 'published_at', type: 'timestamptz' })
  publishedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({
    name: 'related_skill_tags',
    type: 'text',
    array: true,
    default: '{}',
  })
  relatedSkillTags: string[];

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
