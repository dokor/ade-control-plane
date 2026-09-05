ALTER TABLE v0_tasks
  ADD COLUMN IF NOT EXISTS workflow_state text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS workflow_reason text NULL,
  ADD COLUMN IF NOT EXISTS workflow_recoverable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS workflow_remediation text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS workflow_human_input_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS workflow_attempt integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS workflow_max_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS workflow_updated_at timestamptz NULL;

ALTER TABLE v0_tasks
  DROP CONSTRAINT IF EXISTS v0_tasks_workflow_state_check,
  DROP CONSTRAINT IF EXISTS v0_tasks_workflow_remediation_check,
  DROP CONSTRAINT IF EXISTS v0_tasks_workflow_attempt_check;

ALTER TABLE v0_tasks
  ADD CONSTRAINT v0_tasks_workflow_state_check CHECK (workflow_state IN ('queued', 'preparing', 'issue-not-ready', 'enriching-issue', 'validating-issue', 'ready-for-dev', 'developing', 'reviewing', 'preparing-pr', 'waiting-human', 'completed', 'failed', 'cancelled')),
  ADD CONSTRAINT v0_tasks_workflow_remediation_check CHECK (workflow_remediation IN ('enrich-issue', 'wait-for-input', 'none')),
  ADD CONSTRAINT v0_tasks_workflow_attempt_check CHECK (workflow_attempt >= 0 AND workflow_max_attempts >= 0 AND workflow_attempt <= workflow_max_attempts);

UPDATE v0_tasks
SET workflow_state = CASE status WHEN 'SUCCESS' THEN 'completed' WHEN 'FAILED' THEN 'failed' WHEN 'CANCELLED' THEN 'cancelled' WHEN 'RUNNING' THEN 'preparing' ELSE 'queued' END,
    workflow_updated_at = COALESCE(workflow_updated_at, updated_at)
WHERE workflow_updated_at IS NULL;
