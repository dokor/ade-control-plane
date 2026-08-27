CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  repository_owner text NOT NULL,
  repository_name text NOT NULL,
  repository_id text NULL,
  state text NOT NULL CHECK (state IN ('enabled', 'paused', 'disabled')),
  priority integer NOT NULL,
  ade_adapter text NOT NULL,
  runner_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS projects_state_priority_idx
  ON projects (state, priority DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS project_snapshots (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  ade_run_id text NULL,
  status text NOT NULL,
  stage text NULL,
  milestone text NULL,
  current_work_ref text NULL,
  current_work_summary text NULL,
  next_work_ref text NULL,
  next_work_summary text NULL,
  waiting_reason text NULL,
  requires_human boolean NOT NULL DEFAULT false,
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS project_snapshots_project_observed_idx
  ON project_snapshots (project_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS runners (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  kind text NOT NULL,
  state text NOT NULL CHECK (state IN ('online', 'offline', 'draining', 'disabled')),
  architecture text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  labels jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_heartbeat_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS runners_state_updated_idx
  ON runners (state, updated_at DESC);

CREATE TABLE IF NOT EXISTS executions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  runner_id uuid NULL REFERENCES runners (id) ON DELETE SET NULL,
  ade_execution_ref text NULL,
  work_ref text NULL,
  capability text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'leased', 'dispatched', 'running', 'succeeded', 'failed', 'cancelled', 'unknown')),
  attempt integer NOT NULL CHECK (attempt > 0),
  requested_at timestamptz NOT NULL,
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  result_summary jsonb NULL,
  error_code text NULL,
  error_summary text NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS executions_project_status_requested_idx
  ON executions (project_id, status, requested_at DESC);

CREATE TABLE IF NOT EXISTS execution_leases (
  id uuid PRIMARY KEY,
  execution_id uuid NOT NULL UNIQUE REFERENCES executions (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  runner_id uuid NULL REFERENCES runners (id) ON DELETE SET NULL,
  owner_id text NOT NULL,
  lease_key text NOT NULL,
  acquired_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  released_at timestamptz NULL,
  release_reason text NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS execution_leases_active_lease_key_idx
  ON execution_leases (lease_key)
  WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS execution_leases_active_expiry_idx
  ON execution_leases (expires_at)
  WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS provider_quota_snapshots (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  account_ref text NOT NULL,
  policy_state text NOT NULL CHECK (policy_state IN ('normal', 'throttled', 'draining', 'blocked', 'unknown')),
  used_percent numeric NULL,
  window_started_at timestamptz NULL,
  resets_at timestamptz NULL,
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS provider_quota_snapshots_lookup_idx
  ON provider_quota_snapshots (provider, account_ref, observed_at DESC);

CREATE TABLE IF NOT EXISTS control_commands (
  id uuid PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('dashboard', 'github', 'system')),
  actor_type text NOT NULL,
  actor_ref text NOT NULL,
  project_id uuid NULL REFERENCES projects (id) ON DELETE SET NULL,
  command_type text NOT NULL,
  payload jsonb NOT NULL,
  idempotency_key text NULL,
  status text NOT NULL CHECK (status IN ('received', 'authorized', 'rejected', 'applied', 'failed')),
  received_at timestamptz NOT NULL,
  applied_at timestamptz NULL,
  result_summary jsonb NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS control_commands_source_idempotency_idx
  ON control_commands (source, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS control_commands_project_received_idx
  ON control_commands (project_id, received_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  category text NOT NULL,
  severity text NOT NULL,
  actor_type text NOT NULL,
  actor_ref text NULL,
  project_id uuid NULL REFERENCES projects (id) ON DELETE SET NULL,
  execution_id uuid NULL REFERENCES executions (id) ON DELETE SET NULL,
  runner_id uuid NULL REFERENCES runners (id) ON DELETE SET NULL,
  action text NOT NULL,
  reason text NULL,
  result text NULL,
  correlation_id text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_events_project_occurred_idx
  ON audit_events (project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_execution_occurred_idx
  ON audit_events (execution_id, occurred_at DESC);
