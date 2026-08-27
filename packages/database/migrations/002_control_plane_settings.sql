CREATE TABLE IF NOT EXISTS control_plane_settings (
  id text PRIMARY KEY CHECK (id = 'singleton'),
  scheduler_mode text NOT NULL CHECK (scheduler_mode IN ('running', 'paused', 'safe_mode')),
  quota_throttled_percent numeric NOT NULL CHECK (quota_throttled_percent >= 0 AND quota_throttled_percent <= 100),
  quota_draining_percent numeric NOT NULL CHECK (quota_draining_percent >= 0 AND quota_draining_percent <= 100),
  quota_blocked_percent numeric NOT NULL CHECK (quota_blocked_percent >= 0 AND quota_blocked_percent <= 100),
  quota_stale_after_ms integer NOT NULL CHECK (quota_stale_after_ms > 0),
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by text NULL
);

-- The control plane starts globally paused: privileged dispatch must be an
-- explicit, audited human decision rather than a deployment side effect.
INSERT INTO control_plane_settings (
  id, scheduler_mode, quota_throttled_percent, quota_draining_percent,
  quota_blocked_percent, quota_stale_after_ms, updated_at, updated_by
)
VALUES ('singleton', 'paused', 70, 85, 95, 300000, CURRENT_TIMESTAMP, 'system')
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS audit_events_occurred_idx
  ON audit_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS control_commands_received_idx
  ON control_commands (received_at DESC);

CREATE INDEX IF NOT EXISTS executions_status_requested_idx
  ON executions (status, requested_at DESC);
