ALTER TABLE v0_tasks
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'prompt',
  ADD COLUMN IF NOT EXISTS github_issue_number integer NULL;

ALTER TABLE v0_tasks
  DROP CONSTRAINT IF EXISTS v0_tasks_source_type_check,
  DROP CONSTRAINT IF EXISTS v0_tasks_github_issue_number_check,
  DROP CONSTRAINT IF EXISTS v0_tasks_source_consistency_check;

ALTER TABLE v0_tasks
  ADD CONSTRAINT v0_tasks_source_type_check
    CHECK (source_type IN ('prompt', 'github-issue')),
  ADD CONSTRAINT v0_tasks_github_issue_number_check
    CHECK (github_issue_number IS NULL OR github_issue_number > 0),
  ADD CONSTRAINT v0_tasks_source_consistency_check
    CHECK (
      (source_type = 'prompt' AND github_issue_number IS NULL) OR
      (source_type = 'github-issue' AND github_issue_number IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS v0_tasks_github_issue_idx
  ON v0_tasks (project_id, github_issue_number)
  WHERE source_type = 'github-issue';
