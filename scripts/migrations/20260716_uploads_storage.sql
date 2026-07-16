-- uploaded_assets: optional S3 storage (metadata stays in Postgres)
ALTER TABLE uploaded_assets
  ADD COLUMN IF NOT EXISTS storage varchar(8) NOT NULL DEFAULT 'db';

ALTER TABLE uploaded_assets
  ALTER COLUMN data DROP NOT NULL;
