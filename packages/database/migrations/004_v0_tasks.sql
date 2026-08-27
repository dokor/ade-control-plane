CREATE TABLE IF NOT EXISTS v0_tasks (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  prompt text NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 20000),
  status text NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED')),
  cancel_requested boolean NOT NULL DEFAULT false,
  branch_name text NULL,
  pull_request_number integer NULL CHECK (pull_request_number IS NULL OR pull_request_number > 0),
  pull_request_url text NULL,
  error_code text NULL,
  error_summary text NULL,
  created_at timestamptz NOT NULL,
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS v0_tasks_single_active_idx
  ON v0_tasks ((true)) WHERE status IN ('PENDING', 'RUNNING');
CREATE INDEX IF NOT EXISTS v0_tasks_history_idx ON v0_tasks (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS v0_task_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES v0_tasks (id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL,
  stream text NOT NULL CHECK (stream IN ('system', 'stdout', 'stderr')),
  message text NOT NULL CHECK (octet_length(message) <= 4096)
);
CREATE INDEX IF NOT EXISTS v0_task_logs_task_idx ON v0_task_logs (task_id, id ASC);
