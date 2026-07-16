import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Idempotent schema patches for uploaded_assets (prod DB_SYNC=false). */
@Injectable()
export class UploadsSchemaService implements OnModuleInit {
  private readonly logger = new Logger(UploadsSchemaService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS uploaded_assets (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          key varchar(191) NOT NULL UNIQUE,
          mime varchar(64) NOT NULL,
          data bytea,
          storage varchar(8) NOT NULL DEFAULT 'db',
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      await this.dataSource.query(`
        ALTER TABLE uploaded_assets
          ADD COLUMN IF NOT EXISTS storage varchar(8) NOT NULL DEFAULT 'db';
      `);
      await this.dataSource.query(`
        ALTER TABLE uploaded_assets
          ALTER COLUMN data DROP NOT NULL;
      `);
      this.logger.log('uploaded_assets schema ready');
    } catch (err) {
      this.logger.warn(
        `uploaded_assets schema patch failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
