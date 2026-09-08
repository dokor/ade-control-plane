ALTER TABLE github_work_items
  DROP CONSTRAINT IF EXISTS github_work_items_state_check;

ALTER TABLE github_work_items
  ADD CONSTRAINT github_work_items_state_check
  CHECK (state IN ('ready', 'running', 'waiting-human', 'blocked', 'completed', 'failed', 'cancelled'));
