-- Persist admin-uploaded icons (ranks/badges) in Postgres.
-- Railway containers have ephemeral filesystems: files under public/uploads
-- vanish on every deploy/restart, so uploads now live in this table.
CREATE TABLE IF NOT EXISTS uploaded_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key varchar(191) NOT NULL UNIQUE,
  mime varchar(64) NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
