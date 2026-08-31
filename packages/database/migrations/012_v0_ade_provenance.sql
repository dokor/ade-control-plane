ALTER TABLE v0_tasks
  ADD COLUMN IF NOT EXISTS ade_provenance jsonb NULL;
