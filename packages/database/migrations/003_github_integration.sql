-- Transport-level replay protection: one row per GitHub delivery ID.
CREATE TABLE IF NOT EXISTS github_deliveries (
  id uuid PRIMARY KEY,
  delivery_id text NOT NULL UNIQUE,
  event text NOT NULL,
  action text NOT NULL,
  repository_github_id text NOT NULL,
  project_id uuid NULL REFERENCES projects (id) ON DELETE SET NULL,
  actor_ref text NULL,
  subject_type text NULL CHECK (subject_type IN ('issue', 'pull_request')),
  subject_number integer NULL CHECK (subject_number > 0),
  comment_id text NULL,
  status text NOT NULL CHECK (status IN ('received', 'rejected', 'ignored', 'processed')),
  rejection_code text NULL,
  control_command_id uuid NULL REFERENCES control_commands (id) ON DELETE SET NULL,
  received_at timestamptz NOT NULL,
  processed_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS github_deliveries_project_received_idx
  ON github_deliveries (project_id, received_at DESC);

CREATE INDEX IF NOT EXISTS github_deliveries_received_idx
  ON github_deliveries (received_at DESC);

-- Lets the bot update its own comment instead of appending an unbounded thread.
-- Human-authored comments are never referenced here and never rewritten.
CREATE TABLE IF NOT EXISTS github_bot_comments (
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('status', 'waiting-human', 'failure')),
  subject_type text NOT NULL CHECK (subject_type IN ('issue', 'pull_request')),
  subject_number integer NOT NULL CHECK (subject_number > 0),
  comment_id text NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, purpose, subject_type, subject_number)
);

-- Decisions ADE has actually exposed. A GitHub command may only resolve one of
-- these, with one of the options recorded here: it can never invent a payload.
CREATE TABLE IF NOT EXISTS ade_decisions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  decision_ref text NOT NULL,
  prompt text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('open', 'resolved', 'cancelled')),
  resolved_option text NULL,
  resolved_by text NULL,
  observed_at timestamptz NOT NULL,
  resolved_at timestamptz NULL,
  UNIQUE (project_id, decision_ref)
);

CREATE INDEX IF NOT EXISTS ade_decisions_project_status_idx
  ON ade_decisions (project_id, status, observed_at DESC);

CREATE INDEX IF NOT EXISTS projects_repository_id_idx
  ON projects (repository_id)
  WHERE repository_id IS NOT NULL;
