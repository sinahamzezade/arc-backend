import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Idempotent schema patches for doc 07 completion/re-enrollment.
 * Covers prod (DB_SYNC=false) and dev when synchronize skips existing tables.
 */
@Injectable()
export class RoadmapCompletionSchemaService implements OnModuleInit {
  private readonly logger = new Logger(RoadmapCompletionSchemaService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.dataSource.query(`
        DO $$ BEGIN
          ALTER TYPE roadmaps_status_enum ADD VALUE IF NOT EXISTS 'completed';
        EXCEPTION
          WHEN duplicate_object THEN NULL;
          WHEN undefined_object THEN NULL;
        END $$;
      `);
      await this.dataSource.query(`
        ALTER TABLE roadmaps
          ADD COLUMN IF NOT EXISTS finished_at timestamptz NULL;
      `);
      await this.dataSource.query(`
        ALTER TABLE roadmaps
          ADD COLUMN IF NOT EXISTS completion_summary jsonb NULL;
      `);
      await this.dataSource.query(`
        ALTER TABLE roadmaps
          ADD COLUMN IF NOT EXISTS post_completion_status varchar NULL;
      `);
      await this.dataSource.query(`
        ALTER TABLE lessons
          ADD COLUMN IF NOT EXISTS required boolean NOT NULL DEFAULT true;
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS roadmap_completion_events (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          roadmap_id uuid NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
          skills_mastered int NOT NULL DEFAULT 0,
          skills_partial int NOT NULL DEFAULT 0,
          skills_shaky int NOT NULL DEFAULT 0,
          total_lessons int NOT NULL DEFAULT 0,
          total_xp_earned int NOT NULL DEFAULT 0,
          completion_weeks int NOT NULL DEFAULT 0,
          next_action varchar NULL,
          coach_rationale text NULL,
          coach_ready boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_roadmap_completion_events_user_id
          ON roadmap_completion_events (user_id);
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_roadmap_completion_events_roadmap_id
          ON roadmap_completion_events (roadmap_id);
      `);
      await this.dataSource.query(`
        DO $$ BEGIN
          CREATE TYPE re_enrollment_jobs_status_enum AS ENUM (
            'queued', 'processing', 'ready', 'failed'
          );
        EXCEPTION
          WHEN duplicate_object THEN NULL;
        END $$;
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS re_enrollment_jobs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          previous_roadmap_id uuid NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
          trigger varchar NOT NULL,
          new_goal_id uuid NULL REFERENCES goals(id) ON DELETE SET NULL,
          status re_enrollment_jobs_status_enum NOT NULL DEFAULT 'queued',
          new_roadmap_id uuid NULL REFERENCES roadmaps(id) ON DELETE SET NULL,
          error_code varchar NULL,
          error_message text NULL,
          attempts int NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_re_enrollment_jobs_user_id
          ON re_enrollment_jobs (user_id);
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_re_enrollment_jobs_previous_roadmap_id
          ON re_enrollment_jobs (previous_roadmap_id);
      `);
      await this.dataSource.query(`
        DO $$ BEGIN
          ALTER TYPE reward_ledger_entries_reason_type_enum
            ADD VALUE IF NOT EXISTS 'roadmap';
        EXCEPTION
          WHEN duplicate_object THEN NULL;
          WHEN undefined_object THEN NULL;
        END $$;
      `);
      this.logger.log('roadmap completion schema ready');
    } catch (err) {
      this.logger.warn(
        `roadmap completion schema patch failed: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }
}
