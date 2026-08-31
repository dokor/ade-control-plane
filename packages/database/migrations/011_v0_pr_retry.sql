ALTER TABLE v0_tasks ADD COLUMN IF NOT EXISTS pr_retry_requested boolean NOT NULL DEFAULT false;
