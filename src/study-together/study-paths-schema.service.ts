import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Idempotent schema for study_paths (Unit co-roadmaps).
 * Covers prod (DB_SYNC=false) — SQL under scripts/migrations is not auto-run.
 */
@Injectable()
export class StudyPathsSchemaService implements OnModuleInit {
  private readonly logger = new Logger(StudyPathsSchemaService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS study_paths (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          creator_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          partner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          stack varchar NOT NULL,
          creator_lesson_id uuid NOT NULL,
          category varchar(64) NOT NULL DEFAULT 'general',
          title varchar(200) NOT NULL,
          status varchar(24) NOT NULL DEFAULT 'invited',
          content_step int NOT NULL DEFAULT 0,
          step_count int NOT NULL DEFAULT 0,
          progress_percent int NOT NULL DEFAULT 0,
          invite_message varchar(160) NULL,
          invite_expires_at timestamptz NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
      `);

      // Older migration used unit_id; entity now uses stack.
      await this.dataSource.query(`
        DO $$ BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'study_paths'
              AND column_name = 'unit_id'
          ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'study_paths'
              AND column_name = 'stack'
          ) THEN
            ALTER TABLE study_paths RENAME COLUMN unit_id TO stack;
          END IF;
        END $$;
      `);

      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_study_paths_creator_status
          ON study_paths (creator_id, status);
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_study_paths_partner_status
          ON study_paths (partner_id, status);
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_study_paths_stack_status
          ON study_paths (stack, status);
      `);

      await this.dataSource.query(`
        ALTER TABLE study_sessions
          ADD COLUMN IF NOT EXISTS path_id uuid NULL REFERENCES study_paths(id) ON DELETE SET NULL;
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_study_sessions_path_id
          ON study_sessions (path_id);
      `);

      this.logger.log('study_paths schema ready');
    } catch (err) {
      this.logger.warn(
        `study_paths schema patch failed: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }
}
