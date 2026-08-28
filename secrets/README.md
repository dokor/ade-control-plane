# Runtime secrets

Create these files on the Raspberry before starting Compose. This directory is
ignored by Git except for this README; never commit the values.

Required files:

- `postgres_password` — PostgreSQL password;
- `database_url` — complete DSN, for example
  `postgresql://ade_control_plane:<password>@postgres:5432/ade_control_plane`;
- `dashboard_session_secret` — at least 32 random bytes, encoded as text;
- `dashboard_password_hash` — output of
  `pnpm --filter @ade-control-plane/dashboard exec tsx scripts/hash-password.ts`;
- `github_app_private_key` — the GitHub App PEM private key;
- `codex_api_key` — the API key used by the non-interactive Codex worker.

Restrict the directory and files to the deployment administrator (`chmod 700
secrets && chmod 600 secrets/*` on Linux). Compose mounts them read-only under
`/run/secrets`; values are not copied into either image.
