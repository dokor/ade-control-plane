-- Archiving hides terminal task executions from operational views without
-- deleting their execution, Git, pull request, or bounded-log evidence.
ALTER TABLE v0_tasks
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS archived_by text NULL;

ALTER TABLE v0_tasks
  ADD CONSTRAINT v0_tasks_archive_metadata_check
    CHECK (
      (archived_at IS NULL AND archived_by IS NULL) OR
      (archived_at IS NOT NULL AND char_length(archived_by) BETWEEN 1 AND 256)
    );

CREATE INDEX IF NOT EXISTS v0_tasks_operational_history_idx
  ON v0_tasks (created_at DESC, id DESC) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS v0_tasks_archived_history_idx
  ON v0_tasks (archived_at DESC, created_at DESC, id DESC) WHERE archived_at IS NOT NULL;
