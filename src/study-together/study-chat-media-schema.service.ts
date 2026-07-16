import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Idempotent schema patches for study chat media (voice/image).
 * Covers prod (DB_SYNC=false) and dev when synchronize skips existing tables.
 */
@Injectable()
export class StudyChatMediaSchemaService implements OnModuleInit {
  private readonly logger = new Logger(StudyChatMediaSchemaService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS study_session_messages (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          session_id uuid NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
          sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          body varchar(500) NOT NULL DEFAULT '',
          kind varchar(16) NOT NULL DEFAULT 'text',
          media_key varchar(191) NULL,
          media_mime varchar(64) NULL,
          duration_ms int NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_study_session_messages_session_created
          ON study_session_messages (session_id, created_at);
      `);
      await this.dataSource.query(`
        ALTER TABLE study_session_messages
          ADD COLUMN IF NOT EXISTS kind varchar(16) NOT NULL DEFAULT 'text';
      `);
      await this.dataSource.query(`
        ALTER TABLE study_session_messages
          ADD COLUMN IF NOT EXISTS media_key varchar(191) NULL;
      `);
      await this.dataSource.query(`
        ALTER TABLE study_session_messages
          ADD COLUMN IF NOT EXISTS media_mime varchar(64) NULL;
      `);
      await this.dataSource.query(`
        ALTER TABLE study_session_messages
          ADD COLUMN IF NOT EXISTS duration_ms int NULL;
      `);
      await this.dataSource.query(`
        ALTER TABLE study_session_messages
          ALTER COLUMN body SET DEFAULT '';
      `);
      await this.dataSource.query(`
        ALTER TABLE study_session_participants
          ADD COLUMN IF NOT EXISTS chat_last_read_at timestamptz NULL;
      `);
      this.logger.log('study_session_messages media schema ready');
    } catch (err) {
      this.logger.warn(
        `study chat media schema patch failed: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }
}
