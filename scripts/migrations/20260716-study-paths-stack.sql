-- Bind study_paths to content-pool stack (not lesson-level unit slug).
ALTER TABLE study_paths RENAME COLUMN unit_id TO stack;
ALTER INDEX IF EXISTS "IDX_12994b940abcabf4359a7f225b" RENAME TO "IDX_study_paths_stack_status";
