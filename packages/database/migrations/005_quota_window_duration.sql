ALTER TABLE provider_quota_snapshots
  ADD COLUMN IF NOT EXISTS window_duration_mins integer NULL
  CHECK (window_duration_mins IS NULL OR window_duration_mins > 0);
