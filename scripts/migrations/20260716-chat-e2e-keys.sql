-- Chat E2E: identity public keys + per-member conversation key wraps

CREATE TABLE IF NOT EXISTS chat_user_keys (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  public_key varchar(128) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_conversation_key_wraps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wrapped_key text NOT NULL,
  key_epoch int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_conv_key_wraps_member_epoch
  ON chat_conversation_key_wraps (conversation_id, user_id, key_epoch);

CREATE INDEX IF NOT EXISTS idx_chat_conv_key_wraps_conv_user
  ON chat_conversation_key_wraps (conversation_id, user_id);
