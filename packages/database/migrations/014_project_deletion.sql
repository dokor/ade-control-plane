-- A request survives Dashboard/worker separation; only the worker can remove
-- a checkout because it is the only process with that volume mounted.
CREATE TABLE IF NOT EXISTS project_deletion_requests (
  project_id uuid PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL
);

-- Project deletion is an erasure operation: retained NULL references would be
-- orphaned local history rather than a complete purge.
ALTER TABLE control_commands DROP CONSTRAINT IF EXISTS control_commands_project_id_fkey;
ALTER TABLE control_commands ADD CONSTRAINT control_commands_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE;
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_project_id_fkey;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE;
ALTER TABLE github_deliveries DROP CONSTRAINT IF EXISTS github_deliveries_project_id_fkey;
ALTER TABLE github_deliveries ADD CONSTRAINT github_deliveries_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE;
