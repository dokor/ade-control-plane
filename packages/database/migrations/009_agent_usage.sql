CREATE TABLE IF NOT EXISTS agent_usage (
  id uuid PRIMARY KEY,
  execution_id uuid NULL REFERENCES executions (id) ON DELETE CASCADE,
  task_id uuid NULL REFERENCES v0_tasks (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  github_issue_number integer NULL CHECK (github_issue_number IS NULL OR github_issue_number > 0),
  github_pull_request_number integer NULL CHECK (github_pull_request_number IS NULL OR github_pull_request_number > 0),
  provider text NOT NULL,
  model text NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NULL,
  wall_duration_ms bigint NULL CHECK (wall_duration_ms IS NULL OR wall_duration_ms >= 0),
  provider_duration_ms bigint NULL CHECK (provider_duration_ms IS NULL OR provider_duration_ms >= 0),
  provider_api_duration_ms bigint NULL CHECK (provider_api_duration_ms IS NULL OR provider_api_duration_ms >= 0),
  turn_count integer NULL CHECK (turn_count IS NULL OR turn_count >= 0),
  input_tokens bigint NULL CHECK (input_tokens IS NULL OR input_tokens >= 0),
  cached_input_tokens bigint NULL CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
  cache_write_input_tokens bigint NULL CHECK (cache_write_input_tokens IS NULL OR cache_write_input_tokens >= 0),
  output_tokens bigint NULL CHECK (output_tokens IS NULL OR output_tokens >= 0),
  reasoning_output_tokens bigint NULL CHECK (reasoning_output_tokens IS NULL OR reasoning_output_tokens >= 0),
  total_tokens bigint NULL CHECK (total_tokens IS NULL OR total_tokens >= 0),
  cost_amount numeric NULL CHECK (cost_amount IS NULL OR cost_amount >= 0),
  cost_currency text NULL,
  cost_kind text NOT NULL CHECK (cost_kind IN ('provider_reported', 'api_pricing_estimate', 'subscription_included', 'credit_consumption', 'unknown')),
  usage_source text NOT NULL,
  provider_execution_ref text NULL,
  observed_at timestamptz NOT NULL,
  CHECK (execution_id IS NOT NULL OR task_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS agent_usage_project_observed_idx
  ON agent_usage (project_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS agent_usage_provider_observed_idx
  ON agent_usage (provider, observed_at DESC);
CREATE INDEX IF NOT EXISTS agent_usage_task_idx ON agent_usage (task_id);
CREATE INDEX IF NOT EXISTS agent_usage_execution_idx ON agent_usage (execution_id);
