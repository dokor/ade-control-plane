# V0 Raspberry deployment

This is the short deployment procedure for issue #26 and the V0 path from
issue #1. It runs the Dashboard, the V0 Codex task worker and PostgreSQL. The
worker is the only container with access to the registered project checkout and
Git push configuration.

Compose explicitly starts `apps/worker/src/v0/main.ts`, so Dashboard-created
tasks are claimed by the V0 task worker. The GitHub-first multi-project
entrypoint is post-V0 and is not substituted implicitly.

## Host preparation

Use a 64-bit Raspberry Pi OS installation with Docker Engine and the Compose
plugin. Keep the checkout, PostgreSQL volume and project repositories on the
SSD. Keep the production configuration and secret files outside the Git
checkout, matching the other Raspberry applications:

```bash
sudo install -d -o root -g root -m 0750 /srv/configs/ade-control-plane
sudo install -d -o root -g root -m 0700 /srv/configs/ade-control-plane/secrets
sudo install -o root -g root -m 0600 .env.example /srv/configs/ade-control-plane/.env.prod
sudo groupadd --system ade-secrets
```

Populate `/srv/configs/ade-control-plane/.env.prod` with `DASHBOARD_PUBLIC_URL`, `GITHUB_APP_ID`,
`GITHUB_APP_INSTALLATION_ID`, and the host paths for `V0_PROJECTS_HOST` and
`V0_GIT_HOME_HOST` if the defaults are not suitable. The Git home must contain
only the credentials/configuration needed to push the allow-listed GitHub
repositories. Do not mount a Docker socket.

Create the runtime files described in [`secrets/README.md`](../secrets/README.md)
under `/srv/configs/ade-control-plane/secrets` and set `SECRETS_DIR` to that
directory in `.env.prod`.
Set `SECRETS_GID` to the numeric GID of `ade-secrets`, then make each secret
file `root:ade-secrets` with mode `0640`. The secret directory itself remains
root-only; the group only grants the non-root Dashboard/worker processes read
access to the individual files that Compose already mounts for them.
The database URL must use the Compose service name `postgres`, not a public
host address. Register projects with a numeric GitHub repository ID and a relative `configuration.v0.checkout`
under `V0_PROJECTS_HOST`; the worker rejects absolute paths, traversal and
GitHub remotes that do not match the registered repository.

## Start and verify

```bash
docker compose --env-file /srv/configs/ade-control-plane/.env.prod build
docker compose --env-file /srv/configs/ade-control-plane/.env.prod up -d
docker compose --env-file /srv/configs/ade-control-plane/.env.prod ps
docker compose --env-file /srv/configs/ade-control-plane/.env.prod logs --tail=100 dashboard worker
curl -fsS http://127.0.0.1:${DASHBOARD_BIND_PORT:-3000}/api/health
```

The Dashboard stays bound to loopback for local diagnostics and is also joined
to the existing external Docker network named `proxy`. Set
`DASHBOARD_PUBLIC_HOST` to the DNS name used by Traefik; Compose supplies the
HTTPS router, certificate resolver and HTTP-to-HTTPS redirect labels in the
same style as the existing Argos applications. Do not publish PostgreSQL or
the worker. The Dashboard login is still required even when the reverse proxy
is on a private network.

The worker has a separate, non-published outbound bridge network for Codex,
GitHub and Git-over-SSH. PostgreSQL remains on the internal control network
only; the worker does not expose an inbound host port.

PostgreSQL uses the upstream image's short root bootstrap to initialize its
owned volume and switch to the `postgres` account. The Dashboard and worker
remain non-root, read-only and drop all capabilities.

The official Codex installer in the worker image selects the native image
architecture. The worker receives the Codex API key only through a Compose
secret and passes it only to the Codex child process; the Git process receives
a separate environment.

## Optional live Codex quota gate

Issue #4 adds an optional live quota gate through Codex App Server. Run App
Server with the same persisted `CODEX_HOME` used by the worker and configure
`CODEX_APP_SERVER_URL` in `.env.prod`, for example:

```bash
codex app-server --listen ws://127.0.0.1:4500
```

```dotenv
CODEX_APP_SERVER_URL=ws://127.0.0.1:4500
CODEX_CREDENTIAL_REF=codex-account-main
```

The worker reads `account/rateLimits/read` before claiming work, persists only
the normalized observation and refuses new work for blocked or unknown quota.
Leave the URL empty until App Server is available; the worker keeps the V0
normal-quota fallback. Never put a Codex credential in the URL.

## Update, restart and backup

```bash
git pull --ff-only
docker compose --env-file /srv/configs/ade-control-plane/.env.prod build --pull
docker compose --env-file /srv/configs/ade-control-plane/.env.prod up -d
docker compose --env-file /srv/configs/ade-control-plane/.env.prod ps
```

For a restart without rebuilding:

```bash
docker compose --env-file /srv/configs/ade-control-plane/.env.prod restart dashboard worker
```

Back up PostgreSQL before upgrades and copy the dump off the Raspberry:

```bash
mkdir -p backups
docker compose --env-file /srv/configs/ade-control-plane/.env.prod exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  | gzip > "backups/ade-control-plane-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
```

The named `postgres_data` and `codex_home` volumes survive container
recreation. A worker restart retains active GitHub-work leases for
reconciliation; it does not blindly rerun an interrupted issue.

## GitHub Actions deployment

Issue #36 adds `.github/workflows/deploy.yml`. It listens to the existing CI
workflow and runs only after a successful `push` workflow for the repository's
`main` branch. It targets a dedicated self-hosted runner with labels
`self-hosted`, `linux`, `arm64` and `ade-deploy`, and serializes deployments
with a GitHub Actions concurrency group. Configure the workflow's `production`
environment according to the repository's approval policy.

Install the runner under the existing non-root `github-runner` account. Keep
the application checkout at `/srv/apps/ade-control-plane`, configure its GitHub remote
and deployment-only Git credentials, then install the reviewed wrapper and
sudoers entry:

```bash
sudo install -o root -g root -m 0755 deploy/bin/deploy /usr/local/sbin/ade-control-plane-deploy
sudo install -o root -g root -m 0440 deploy/sudoers/ade-deploy /etc/sudoers.d/ade-deploy
sudo visudo -cf /etc/sudoers.d/ade-deploy
```

The ADE workflow does not require Docker-group membership. The workflow can
invoke only `/usr/local/sbin/ade-control-plane-deploy`; it cannot invoke generic
`sudo` commands or `sudo docker` through its ADE sudo policy. If the shared
`github-runner` account already belongs to the Docker group for another
application, that is pre-existing host-wide authority and should be reviewed
separately. The wrapper accepts one validated commit SHA,
requires the allow-listed repository and clean checkout, builds the selected
version, starts PostgreSQL, runs the migration command, starts the application,
waits for all Compose healthchecks and records the deployed SHA in
`/var/lib/ade-control-plane/deployed-sha`. It never prints secrets.

The wrapper itself must be reviewed and reinstalled from an approved `main`
commit when it changes. Production runtime secrets remain in the protected
`/srv/configs/ade-control-plane/secrets` directory on the Raspberry; GitHub Actions receives no database,
GitHub or Codex secret.

## Manual redeploy and rollback

The same wrapper is the break-glass path for a known-good commit:

```bash
sudo -n /usr/local/sbin/ade-control-plane-deploy <known-good-40-character-sha>
cat /var/lib/ade-control-plane/deployed-sha
docker compose --env-file /srv/configs/ade-control-plane/.env.prod ps
```

Only rollback to a commit whose migrations are compatible with the current
database. Database migrations are not automatically reversed. Keep the manual
procedure available even when GitHub Actions is enabled.

## Reboot validation

Enable Docker at boot, reboot the host, then verify:

```bash
sudo systemctl enable --now docker
docker compose --env-file /srv/configs/ade-control-plane/.env.prod ps
curl -fsS http://127.0.0.1:3000/api/health
```

After logging in, the task history must still be present. The release test is
to submit a small task from a phone through the HTTPS reverse proxy and verify
that the Dashboard shows sanitized logs, the `ade/<task-id>` branch and the
GitHub pull request.
