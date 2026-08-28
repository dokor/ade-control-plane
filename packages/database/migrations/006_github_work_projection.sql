CREATE TABLE IF NOT EXISTS github_work_profiles (
  project_id uuid PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  repository_github_id text NOT NULL,
  compatible boolean NOT NULL,
  contract_version text NULL,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  skill_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text NOT NULL CHECK (reason IN ('compatible', 'missing-profile', 'invalid-profile', 'unsupported-profile')),
  observed_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS github_work_profiles_repository_idx
  ON github_work_profiles (repository_github_id);

CREATE TABLE IF NOT EXISTS github_work_items (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  repository_github_id text NOT NULL,
  contract_version text NOT NULL,
  issue_number integer NOT NULL CHECK (issue_number > 0),
  issue_url text NOT NULL,
  state text NOT NULL CHECK (state IN ('ready', 'running', 'waiting-human', 'blocked', 'completed', 'failed')),
  priority integer NOT NULL CHECK (priority BETWEEN 0 AND 100),
  depends_on jsonb NOT NULL DEFAULT '[]'::jsonb,
  retry_policy text NOT NULL CHECK (retry_policy IN ('safe', 'reconcile-first', 'never')),
  human_decision_ref text NULL,
  execution_ref text NULL,
  branch_name text NULL,
  pull_request_number integer NULL CHECK (pull_request_number IS NULL OR pull_request_number > 0),
  source_updated_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  present boolean NOT NULL DEFAULT true,
  UNIQUE (project_id, issue_number)
);

CREATE INDEX IF NOT EXISTS github_work_items_project_queue_idx
  ON github_work_items (project_id, present, priority DESC, issue_number ASC);
