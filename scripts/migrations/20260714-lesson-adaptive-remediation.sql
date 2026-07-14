-- §8 + §16.3 schema additions (idempotent).
-- Dev uses TypeORM synchronize (DB_SYNC); run this when DB_SYNC=false.

-- lesson_progress extras (§8) — no-op if already present
ALTER TABLE lesson_progress
  ADD COLUMN IF NOT EXISTS session_state jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE lesson_progress
  ADD COLUMN IF NOT EXISTS gems_awarded int NOT NULL DEFAULT 0;
ALTER TABLE lesson_progress
  ADD COLUMN IF NOT EXISTS coins_awarded int NOT NULL DEFAULT 0;
ALTER TABLE lesson_progress
  ADD COLUMN IF NOT EXISTS quiz_correct int NULL;
ALTER TABLE lesson_progress
  ADD COLUMN IF NOT EXISTS quiz_total int NULL;
ALTER TABLE lesson_progress
  ADD COLUMN IF NOT EXISTS practice_correct boolean NULL;

-- lesson_attempts.concept_mastery (§16.3)
ALTER TABLE lesson_attempts
  ADD COLUMN IF NOT EXISTS concept_mastery jsonb NOT NULL DEFAULT '{}'::jsonb;

-- remediation_events (§16.3)
CREATE TABLE IF NOT EXISTS remediation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES lesson_attempts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  concept_tag text NOT NULL,
  trigger_item_id text NOT NULL,
  recovery_item_id text NULL,
  round int NOT NULL,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_remediation_attempt_concept_round
    UNIQUE (attempt_id, concept_tag, round)
);

CREATE INDEX IF NOT EXISTS idx_remediation_events_attempt_id
  ON remediation_events (attempt_id);
CREATE INDEX IF NOT EXISTS idx_remediation_events_user_id
  ON remediation_events (user_id);
CREATE INDEX IF NOT EXISTS idx_remediation_events_lesson_id
  ON remediation_events (lesson_id);

-- user_badges already owned by BadgesModule (full schema) — no CREATE here.
