-- Remove profile basics onboarding fields (prod / DB_SYNC=false).
-- current_role must be quoted — CURRENT_ROLE is a PostgreSQL reserved keyword.
ALTER TABLE profiles DROP COLUMN IF EXISTS "current_role";
ALTER TABLE profiles DROP COLUMN IF EXISTS target_role;
ALTER TABLE profiles DROP COLUMN IF EXISTS years_experience;
