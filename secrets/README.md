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
- `codex_api_key` — optional API key for the non-interactive Codex worker;
  create an empty file when using persisted Codex/ChatGPT login instead.

Keep the directory owned and searchable only by the deployment administrator
(`chmod 700 secrets`). With local Docker Compose, file-backed secrets are bind
mounted with their host ownership, so create a dedicated `ade-secrets` group,
make each file `root:ade-secrets` with mode `0640`, and add its numeric GID as
`SECRETS_GID`. Compose mounts only the explicitly listed files read-only under
`/run/secrets`; values are not copied into either image.
