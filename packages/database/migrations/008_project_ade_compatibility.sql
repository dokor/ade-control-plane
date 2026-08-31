ALTER TABLE github_work_profiles
  ADD COLUMN IF NOT EXISTS ade_status text NOT NULL DEFAULT 'setup-required',
  ADD COLUMN IF NOT EXISTS ade_config_version text NULL,
  ADD COLUMN IF NOT EXISTS ade_runtime_version text NULL,
  ADD COLUMN IF NOT EXISTS resolved_profiles jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS resolved_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS context_status text NOT NULL DEFAULT 'unknown';

UPDATE github_work_profiles
SET ade_status = CASE
  WHEN compatible THEN 'compatible'
  WHEN reason = 'missing-profile' THEN 'setup-required'
  ELSE 'incompatible'
END
WHERE ade_status = 'setup-required';

ALTER TABLE github_work_profiles
  DROP CONSTRAINT IF EXISTS github_work_profiles_ade_status_check,
  DROP CONSTRAINT IF EXISTS github_work_profiles_context_status_check;

ALTER TABLE github_work_profiles
  ADD CONSTRAINT github_work_profiles_ade_status_check
    CHECK (ade_status IN ('setup-required', 'validating', 'compatible', 'invalid', 'upgrade-required', 'incompatible')),
  ADD CONSTRAINT github_work_profiles_context_status_check
    CHECK (context_status IN ('fresh', 'stale', 'missing', 'unknown'));
