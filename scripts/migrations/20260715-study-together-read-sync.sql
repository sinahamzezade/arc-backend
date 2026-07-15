-- Study Together: shared lesson reading + chat
ALTER TABLE study_sessions
  ADD COLUMN IF NOT EXISTS lesson_id uuid NULL,
  ADD COLUMN IF NOT EXISTS unit_id varchar NULL,
  ADD COLUMN IF NOT EXISTS lesson_title varchar(200) NULL,
  ADD COLUMN IF NOT EXISTS mode varchar(24) NOT NULL DEFAULT 'read_together',
  ADD COLUMN IF NOT EXISTS content_step int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS step_count int NOT NULL DEFAULT 0;

ALTER TABLE study_session_participants
  ADD COLUMN IF NOT EXISTS acked_step int NOT NULL DEFAULT -1,
  ADD COLUMN IF NOT EXISTS typing_at timestamptz NULL;

CREATE TABLE IF NOT EXISTS study_session_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body varchar(500) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_study_session_messages_session_created
  ON study_session_messages (session_id, created_at);
