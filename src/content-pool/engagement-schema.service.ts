import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Idempotent schema patches for engagement layer (doc 10).
 * Covers prod (DB_SYNC=false) and synchronize skips on existing tables.
 */
@Injectable()
export class EngagementSchemaService implements OnModuleInit {
  private readonly logger = new Logger(EngagementSchemaService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.dataSource.query(`
        ALTER TABLE units
          ADD COLUMN IF NOT EXISTS simulation_asset_key varchar NULL;
      `);
      await this.dataSource.query(`
        ALTER TABLE units
          ADD COLUMN IF NOT EXISTS action_vocabulary text[] NOT NULL DEFAULT '{}';
      `);
      await this.dataSource.query(`
        ALTER TABLE role_recipes
          ADD COLUMN IF NOT EXISTS phase_narrative_titles text[] NOT NULL DEFAULT '{}';
      `);
      await this.dataSource.query(`
        ALTER TABLE role_recipes
          ADD COLUMN IF NOT EXISTS complementary_skill_tags text[] NOT NULL DEFAULT '{}';
      `);
      await this.dataSource.query(`
        ALTER TABLE roadmap_phases
          ADD COLUMN IF NOT EXISTS narrative_title varchar NULL;
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS coach_relationship_state (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
          rapport_score int NOT NULL DEFAULT 0,
          last_tone varchar NOT NULL DEFAULT 'steady',
          running_jokes jsonb NOT NULL DEFAULT '[]'::jsonb,
          last_active_at timestamptz NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS live_context_snippets (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          track_tag varchar NOT NULL,
          headline varchar NOT NULL,
          body text NOT NULL,
          source_url text NULL,
          published_at timestamptz NOT NULL,
          expires_at timestamptz NOT NULL,
          related_skill_tags text[] NOT NULL DEFAULT '{}',
          is_active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_live_context_snippets_track_active
          ON live_context_snippets (track_tag, is_active, expires_at DESC);
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS cross_track_nudges (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          roadmap_id uuid NULL REFERENCES roadmaps(id) ON DELETE SET NULL,
          unit_id varchar NOT NULL,
          week_start date NOT NULL,
          surfaced_at timestamptz NOT NULL DEFAULT now(),
          completed_at timestamptz NULL,
          UNIQUE (user_id, week_start)
        );
      `);
      this.logger.log('Engagement schema patches applied');
    } catch (err) {
      this.logger.error(
        `Engagement schema patch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
