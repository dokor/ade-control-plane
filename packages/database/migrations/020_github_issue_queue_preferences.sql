-- Operator queue intent is deliberately independent from GitHub reconciliation:
-- GitHub remains the source of issue content and ADE work state, while this
-- table retains only a durable opt-in and explicit ordering preference.
CREATE TABLE IF NOT EXISTS github_issue_queue_preferences (
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  issue_number integer NOT NULL CHECK (issue_number > 0),
  run_when_available boolean NOT NULL DEFAULT false,
  queue_position integer NULL CHECK (queue_position IS NULL OR queue_position > 0),
  updated_at timestamptz NOT NULL,
  updated_by text NOT NULL,
  PRIMARY KEY (project_id, issue_number),
  CHECK ((run_when_available AND queue_position IS NOT NULL) OR (NOT run_when_available AND queue_position IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS github_issue_queue_preferences_enabled_position_idx
  ON github_issue_queue_preferences (project_id, queue_position)
  WHERE run_when_available;
