ALTER TABLE github_work_profiles
  ADD COLUMN IF NOT EXISTS ade_missing_required_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS runner_checkout_ref text NULL;

-- A discovered GitHub profile is necessary, but it is not proof that ADE can
-- execute in the runner checkout. Existing unproven records must revalidate.
UPDATE github_work_profiles
SET ade_status = 'setup-required'
WHERE ade_status = 'compatible'
  AND ade_config_version IS NULL;
