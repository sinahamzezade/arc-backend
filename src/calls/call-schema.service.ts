import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class CallSchemaService implements OnModuleInit {
  private readonly logger = new Logger(CallSchemaService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS calls (
          id uuid PRIMARY KEY,
          conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          caller_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          callee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          mode varchar(16) NOT NULL,
          state varchar(16) NOT NULL,
          end_reason varchar(16) NULL,
          used_turn boolean NOT NULL DEFAULT false,
          started_at timestamptz NULL,
          ended_at timestamptz NULL,
          duration_sec int NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_calls_caller_created
          ON calls (caller_id, created_at DESC);
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_calls_callee_created
          ON calls (callee_id, created_at DESC);
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_calls_conversation_created
          ON calls (conversation_id, created_at DESC);
      `);

      await this.dataSource.query(`
        ALTER TABLE social_privacy_settings
          ADD COLUMN IF NOT EXISTS allow_video_calls boolean NOT NULL DEFAULT true;
      `);
      await this.dataSource.query(`
        ALTER TABLE social_privacy_settings
          ADD COLUMN IF NOT EXISTS allow_voice_calls boolean NOT NULL DEFAULT true;
      `);

      await this.dataSource.query(`
        DO $$ BEGIN
          ALTER TYPE notifications_type_enum ADD VALUE IF NOT EXISTS 'incoming_call';
        EXCEPTION WHEN undefined_object THEN NULL;
        END $$;
      `);
      await this.dataSource.query(`
        DO $$ BEGIN
          ALTER TYPE notification_schedules_type_enum ADD VALUE IF NOT EXISTS 'incoming_call';
        EXCEPTION WHEN undefined_object THEN NULL;
        END $$;
      `);

      this.logger.log('Call schema ready');
    } catch (err) {
      this.logger.error(
        `Call schema bootstrap failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
