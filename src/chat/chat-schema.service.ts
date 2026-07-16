import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Idempotent schema patches for chat tables + user/privacy columns.
 * Covers prod (DB_SYNC=false) and partial sync gaps.
 */
@Injectable()
export class ChatSchemaService implements OnModuleInit {
  private readonly logger = new Logger(ChatSchemaService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.dataSource.query(`
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS is_minor boolean NOT NULL DEFAULT false;
      `);
      await this.dataSource.query(`
        ALTER TABLE social_privacy_settings
          ADD COLUMN IF NOT EXISTS allow_messages_from varchar(16) NOT NULL DEFAULT 'friends';
      `);
      await this.dataSource.query(`
        ALTER TABLE social_privacy_settings
          ADD COLUMN IF NOT EXISTS presence_visibility varchar(16) NOT NULL DEFAULT 'contacts';
      `);

      // NotificationType.ChatMessage for PG enum columns
      await this.dataSource.query(`
        DO $$ BEGIN
          ALTER TYPE notifications_type_enum ADD VALUE IF NOT EXISTS 'chat_message';
        EXCEPTION WHEN undefined_object THEN NULL;
        END $$;
      `);
      await this.dataSource.query(`
        DO $$ BEGIN
          ALTER TYPE notification_schedules_type_enum ADD VALUE IF NOT EXISTS 'chat_message';
        EXCEPTION WHEN undefined_object THEN NULL;
        END $$;
      `);

      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS conversations (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          type varchar(16) NOT NULL,
          title varchar(120) NULL,
          avatar_url varchar(512) NULL,
          created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          direct_pair_key varchar(80) NULL,
          last_message_at timestamptz NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      await this.dataSource.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_direct_pair
          ON conversations (type, direct_pair_key)
          WHERE type = 'direct' AND direct_pair_key IS NOT NULL;
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at
          ON conversations (last_message_at DESC NULLS LAST);
      `);

      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS chat_attachments (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          uploader_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          object_key varchar(255) NOT NULL,
          mime_type varchar(100) NOT NULL,
          size_bytes int NOT NULL,
          scan_status varchar(16) NOT NULL DEFAULT 'pending',
          conversation_id uuid NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_chat_attachments_conversation
          ON chat_attachments (conversation_id);
      `);

      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          client_msg_id uuid NOT NULL,
          type varchar(16) NOT NULL DEFAULT 'text',
          body text NULL,
          attachment_id uuid NULL REFERENCES chat_attachments(id) ON DELETE SET NULL,
          reply_to_id uuid NULL REFERENCES chat_messages(id) ON DELETE SET NULL,
          edited_at timestamptz NULL,
          deleted_at timestamptz NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      await this.dataSource.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_messages_client_msg
          ON chat_messages (conversation_id, sender_id, client_msg_id);
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_created
          ON chat_messages (conversation_id, created_at, id);
      `);

      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS conversation_members (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role varchar(16) NOT NULL DEFAULT 'member',
          joined_at timestamptz NOT NULL DEFAULT now(),
          last_read_message_id uuid NULL REFERENCES chat_messages(id) ON DELETE SET NULL,
          muted boolean NOT NULL DEFAULT false,
          left_at timestamptz NULL
        );
      `);
      await this.dataSource.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_members_pair
          ON conversation_members (conversation_id, user_id);
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_conversation_members_user
          ON conversation_members (user_id, left_at);
      `);

      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS chat_reports (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          message_id uuid NULL REFERENCES chat_messages(id) ON DELETE SET NULL,
          reported_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          reason varchar(32) NOT NULL,
          detail text NULL,
          status varchar(16) NOT NULL DEFAULT 'open',
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_chat_reports_status_created
          ON chat_reports (status, created_at DESC);
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_chat_reports_reason_status
          ON chat_reports (reason, status);
      `);

      this.logger.log('Chat schema ensured');
    } catch (err) {
      this.logger.error(
        `Chat schema patch failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
