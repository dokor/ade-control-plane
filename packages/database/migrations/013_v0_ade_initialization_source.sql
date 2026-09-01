ALTER TABLE v0_tasks
  DROP CONSTRAINT IF EXISTS v0_tasks_source_type_check,
  DROP CONSTRAINT IF EXISTS v0_tasks_source_consistency_check;

ALTER TABLE v0_tasks
  ADD CONSTRAINT v0_tasks_source_type_check
    CHECK (source_type IN ('prompt', 'github-issue', 'ade-initialize')),
  ADD CONSTRAINT v0_tasks_source_consistency_check
    CHECK (
      (source_type IN ('prompt', 'ade-initialize') AND github_issue_number IS NULL) OR
      (source_type = 'github-issue' AND github_issue_number IS NOT NULL)
    );
