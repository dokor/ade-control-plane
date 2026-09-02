CREATE TABLE IF NOT EXISTS ade_delivery_workflows (
  id uuid PRIMARY KEY,
  execution_id uuid NOT NULL UNIQUE REFERENCES executions (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  issue_number integer NOT NULL CHECK (issue_number > 0),
  source_updated_at timestamptz NOT NULL,
  stage text NOT NULL CHECK (stage IN ('admitted', 'planning', 'enriching', 'ready-for-dev', 'implementing', 'validating', 'reviewing', 'correcting', 'publishing', 'waiting-human', 'completed')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  ade_plan jsonb NULL,
  provenance jsonb NULL,
  provider_execution_ref text NULL,
  validation_summary jsonb NULL,
  review_summary jsonb NULL,
  branch_name text NULL,
  head_sha text NULL,
  pull_request_number integer NULL CHECK (pull_request_number IS NULL OR pull_request_number > 0),
  pull_request_url text NULL,
  retry_classification text NULL,
  reconciliation_required boolean NOT NULL DEFAULT false,
  human_decision_ref text NULL,
  transition_reason text NOT NULL CHECK (char_length(transition_reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS ade_delivery_workflows_project_idx
  ON ade_delivery_workflows (project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ade_delivery_stage_transitions (
  id uuid PRIMARY KEY,
  workflow_id uuid NOT NULL REFERENCES ade_delivery_workflows (id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('admitted', 'planning', 'enriching', 'ready-for-dev', 'implementing', 'validating', 'reviewing', 'correcting', 'publishing', 'waiting-human', 'completed')),
  attempt integer NOT NULL CHECK (attempt >= 0),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 500),
  details jsonb NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (workflow_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ade_delivery_stage_transitions_workflow_idx
  ON ade_delivery_stage_transitions (workflow_id, occurred_at ASC);
