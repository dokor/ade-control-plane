-- A local suppression marker, never a deletion or mutation of GitHub objects.
CREATE TABLE github_work_removals (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  issue_number integer NOT NULL CHECK (issue_number > 0),
  removed_at timestamptz NOT NULL,
  removed_by text NOT NULL,
  PRIMARY KEY (project_id, issue_number)
);
