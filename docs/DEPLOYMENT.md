# V0 Raspberry deployment

This is the short deployment procedure for issue #26 and the V0 path from
issue #1. It runs only the Dashboard, the single V0 Codex worker and
PostgreSQL. The worker is the only container with access to the registered
project checkout and Git push configuration.

## Host preparation

Use a 64-bit Raspberry Pi OS installation with Docker Engine and the Compose
plugin. Keep the checkout, PostgreSQL volume and project repositories on the
SSD. From the repository root:

```bash
cp .env.example .env
mkdir -p data/projects data/git-home secrets
```

Populate `.env` with `DASHBOARD_PUBLIC_URL`, `GITHUB_APP_ID`,
`GITHUB_APP_INSTALLATION_ID`, and the host paths for `V0_PROJECTS_HOST` and
`V0_GIT_HOME_HOST` if the defaults are not suitable. The Git home must contain
only the credentials/configuration needed to push the allow-listed GitHub
repositories. Do not mount a Docker socket.

Create the runtime files described in [`secrets/README.md`](../secrets/README.md).
The database URL must use the Compose service name `postgres`, not a public
host address. Register projects with a relative `configuration.v0.checkout`
under `V0_PROJECTS_HOST`; the worker rejects absolute paths, traversal and
GitHub remotes that do not match the registered repository.

## Start and verify

```bash
docker compose build
docker compose up -d
docker compose ps
docker compose logs --tail=100 dashboard worker
curl -fsS http://127.0.0.1:${DASHBOARD_BIND_PORT:-3000}/api/health
```

The Dashboard is bound to loopback only. Configure the existing reverse proxy
to forward HTTPS traffic to `http://127.0.0.1:3000` (or the configured
`DASHBOARD_BIND_PORT`). Do not publish PostgreSQL or the worker. The Dashboard
login is still required even when the reverse proxy is on a private network.

The official Codex installer in the worker image selects the native image
architecture. The worker receives the Codex API key only through a Compose
secret and passes it only to the Codex child process; the Git process receives
a separate environment.

## Update, restart and backup

```bash
git pull --ff-only
docker compose build --pull
docker compose up -d
docker compose ps
```

For a restart without rebuilding:

```bash
docker compose restart dashboard worker
```

Back up PostgreSQL before upgrades and copy the dump off the Raspberry:

```bash
mkdir -p backups
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  | gzip > "backups/ade-control-plane-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
```

The named `postgres_data` and `codex_home` volumes survive container
recreation. A worker restart reconciles the durable task state according to the
V0 worker policy; it does not blindly rerun an interrupted task.

## Reboot validation

Enable Docker at boot, reboot the host, then verify:

```bash
sudo systemctl enable --now docker
docker compose ps
curl -fsS http://127.0.0.1:${DASHBOARD_BIND_PORT:-3000}/api/health
```

After logging in, the task history must still be present. The release test is
to submit a small task from a phone through the HTTPS reverse proxy and verify
that the Dashboard shows sanitized logs, the `ade/<task-id>` branch and the
GitHub pull request.
