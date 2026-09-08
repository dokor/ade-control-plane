ALTER TABLE github_work_items
  ADD COLUMN IF NOT EXISTS milestone text NULL;
