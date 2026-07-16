-- Study Together: persistent Unit co-roadmaps + episode sessions
CREATE TABLE IF NOT EXISTS study_paths (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unit_id varchar NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_study_paths_creator_status
  ON study_paths (creator_id, status);
CREATE INDEX IF NOT EXISTS idx_study_paths_partner_status
  ON study_paths (partner_id, status);
CREATE INDEX IF NOT EXISTS idx_study_paths_unit_status
  ON study_paths (unit_id, status);

ALTER TABLE study_sessions
  ADD COLUMN IF NOT EXISTS path_id uuid NULL REFERENCES study_paths(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_study_sessions_path_id
  ON study_sessions (path_id);
