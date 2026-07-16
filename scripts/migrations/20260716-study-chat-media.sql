-- Study Together chat: voice + image media + wipe-on-finish fields
ALTER TABLE study_session_messages
  ADD COLUMN IF NOT EXISTS kind varchar(16) NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS media_key varchar(191) NULL,
  ADD COLUMN IF NOT EXISTS media_mime varchar(64) NULL,
  ADD COLUMN IF NOT EXISTS duration_ms int NULL;

-- Allow empty body for pure media messages (caption optional)
ALTER TABLE study_session_messages
  ALTER COLUMN body SET DEFAULT '';
