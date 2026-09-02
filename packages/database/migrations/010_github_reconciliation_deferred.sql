ALTER TABLE github_work_profiles
  DROP CONSTRAINT IF EXISTS github_work_profiles_reason_check;

ALTER TABLE github_work_profiles
  ADD CONSTRAINT github_work_profiles_reason_check
  CHECK (reason IN (
    'compatible',
    'missing-profile',
    'invalid-profile',
    'unsupported-profile',
    'reconciliation-deferred'
  ));
