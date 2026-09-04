# V0 Raspberry deployment

This is the short deployment procedure for issue #26 and the V0 path from
issue #1. It runs the Dashboard, the V0 Codex task worker and PostgreSQL. The
worker is the only container with access to the registered project checkout and
Git push configuration.

Compose explicitly starts `apps/worker/src/v0/main.ts`, so Dashboard-created
tasks are claimed by the V0 task worker. The GitHub-first multi-project
entrypoint is post-V0 and is not substituted implicitly.

## Host preparation

### GitHub App HTTPS authentication (#212)

Both worker entrypoints use the configured GitHub App installation for CP-owned
Git preflight, clone, fetch, push and PR-reconciliation `ls-remote` calls. A separate
worker SSH identity is no longer required. The installation must include the
registered repository with **Contents: read/write**, in addition to the existing
API/PR permissions. Private repositories use the same path.

Tokens are restricted to one repository and Contents write, cached only in memory,
and renewed before expiry. The worker asks the token provider before each network
Git operation, including push after a long agent execution. Credentials use Git's
per-process configuration environment, not command arguments, remote URLs, files,
prompts or agent environments. Output callbacks and captured diagnostics redact
both the raw token and its Basic-auth encoding. Credential helpers, tracing,
redirects, network Git hooks and recursive submodule access are disabled for these
authenticated operations. Clone defers checkout until the credential-free branch
preparation step. Fetch explicitly updates the registered `origin` tracking ref.

Existing SSH origins remain valid for repository identity checks; network requests
use the canonical registered HTTPS URL without rewriting the stored SSH origin.
New clones store a credential-free HTTPS origin. Git commit identity remains in
the existing Git home; deployment-runner credentials are unchanged.

Without Raspberry terminal access: merge/review normally, wait for the production
deployment, then initialize one registered project from Dashboard. Verify checkout,
delivery, push and PR separately. `GIT_AUTH_FAILED` now identifies GitHub App HTTPS
and directs the operator to installation access and Contents permission, without
revealing API responses or tokens. Do not repeatedly retry missing permissions or
restore an insecure SSH bypass. CI alone is not a real private-repository delivery
qualification; #185/#189 still require production evidence.

References: [GitHub installation authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation),
[Git process configuration and HTTP headers](https://git-scm.com/docs/git-config).

### Historical SSH provisioning repair (#183 / #185)

The following describes the older SSH transport and retained image pin. It is not
an SSH credential prerequisite for the GitHub App HTTPS worker path above.

The worker image now includes a root-owned, read-only GitHub Ed25519 host-key
pin at `/etc/ssh/ade_github_known_hosts`. Its fingerprint is verified at build
time against the [official GitHub fingerprint](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints).
No startup keyscan, trust-on-first-use, or manual edit to the mounted Git home
is required. A key rotation requires a reviewed pin/image update; fail closed
until the new official fingerprint is verified.

Compose uses `GIT_SSH=/usr/local/bin/ade-git-ssh`. The worker explicitly passes
this executable to Git only, not the agent environment. The previous
`GIT_SSH_COMMAND` bypass was not forwarded by the worker's environment allow-list;
it is removed, not replaced by another bypass. The wrapper enforces strict host
checking, the image pin, Ed25519 host authentication and non-interactive bounded
SSH connection attempts, even if an old mounted SSH config disables checking.
It reads the mounted Git home's `.ssh/config` and conventional identity files
explicitly because OpenSSH does not use Git's HOME to locate its default config.
The volume remains read-only; no ownership/permission changes are made at startup.

For an operator without terminal access:

1. Review/merge the PR and follow **CI**, then **Deploy production** in GitHub
   Actions (approve the production environment if required). The existing ARM64
   deployment runner rebuilds the worker image; restarting the old image is not enough.
2. Once deployment succeeds, open Dashboard and request ADE initialization for a
   registered project without a checkout. Inspect the new execution, not the old failure.
3. Confirm provisioning proceeds past `Provision checkout`. A later ADE failure
   is separate from Git connectivity; no PR/branch is created by the preflight.
4. Keep #185's production verification pending until a fresh checkout succeeds.
   The unsafe override is removed in code, but CI is not proof of Raspberry credentials.

The existing SSH identity still needs read access for clone/fetch and write access
for push. Keys/config in `V0_GIT_HOME_HOST/.ssh` must already be readable by UID
10002 and have restrictive permissions (directory 0700, private keys/config 0600,
or appropriately controlled equivalent). An SSH agent may also be used when already
configured. This release installs only a **public host key**, not a private identity.
If the deploy runner is unavailable or credentials need provisioning, GitHub/Dashboard
will expose the failure; that remaining host/credential operation cannot be completed
merely by retrying tasks without an authorized server administrator.

New-checkout preflight uses a 30-second `git ls-remote` check on the registered
base branch. Both preflight and clone return specific fixed, secret-free guidance:
`HOST_KEY_VERIFICATION_FAILED`, `GIT_AUTH_FAILED`, `REPOSITORY_NOT_FOUND`,
`REPOSITORY_ACCESS_DENIED`, `GIT_NETWORK_FAILED`, or `GIT_BRANCH_NOT_FOUND`.
Unknown errors retain `GIT_PREFLIGHT_FAILED`/`GIT_CLONE_FAILED` and sanitized
execution diagnostics. GitHub can hide private repositories as “not found”; that
code does not prove the repository is absent. Background provisioning records the
same reason/host/action in the project audit trail without raw command output.

HTTPS with short-lived GitHub App installation tokens remains a possible follow-up:
it would remove SSH host/identity management, but must scope tokens per repository,
refresh them for later pushes, and deliver them through a credential helper without
embedding them in URLs, process arguments, logs or agent environments. Existing App
API credentials are not automatically Git credentials. This incident fix retains SSH
to avoid introducing that separate authentication workflow or new host secrets.

### Initial host installation

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

The worker installs Bubblewrap and deliberately uses `seccomp=unconfined` so
Codex can create its *inner* user-namespace sandbox. Docker's default seccomp
profile blocks that required syscall. This is limited to the private worker:
it remains non-root, has no Linux capabilities, uses `no-new-privileges`, has
a read-only root filesystem, and receives no Docker socket. Do not replace
this with `privileged: true` or run Codex with a full-access sandbox.

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

For a GitHub issue admitted while its registered checkout is not present, the
GitHub worker reuses this same allow-listed provisioning path before starting
ADE planning. A failed clone or remote verification is recorded as a deferred
safe failure; it never runs the issue against another checkout.

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

## Live Codex quota gate

The worker starts Codex App Server locally on `127.0.0.1:4500`, sharing its
persisted `CODEX_HOME`. No configuration, port publishing or Traefik routing
is needed. It reads `account/rateLimits/read` before claiming work, persists
only the normalized observation and refuses new work for blocked, stale or
unknown quota. Never put a Codex credential in a URL.

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
separately. The wrapper accepts one validated commit SHA, requires the
allow-listed repository and clean checkout, selects the changed application
scope, starts PostgreSQL when an application update is needed, waits for the
relevant Compose healthchecks and records the deployed SHA in
`/var/lib/ade-control-plane/deployed-sha`. It never prints secrets.

For a commit that only changes `apps/dashboard`, it rebuilds and restarts only
`dashboard`. A commit limited to `apps/worker` rebuilds and restarts only
`worker`; database migrations are run when migration code changes. Changes to
shared packages, Docker/Compose files, dependencies or migration packages use
the full deployment path. Documentation-only commits are recorded without
restarting containers. If the previous deployed SHA is unavailable, invalid,
or not an ancestor of the requested SHA, the wrapper conservatively uses the
full deployment path.

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
