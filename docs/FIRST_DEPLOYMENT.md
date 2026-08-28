# First Raspberry Deployment Checklist

## Purpose

This is the operational checklist for issue #26. It defines what must be ready before the first real Dashboard → Codex → GitHub PR run on the Raspberry.

## Host prerequisites

- Raspberry Pi 5 on a supported 64-bit Linux distribution.
- SSD-backed storage for PostgreSQL data, backups and project checkouts.
- Docker Engine + Compose plugin installed and working.
- Existing reverse proxy/TLS path identified for the Dashboard.
- System clock/NTP healthy.
- Firewall rules understood before publishing any application port.
- Enough free disk space for images, PostgreSQL, Git checkouts and build output.

## Required directories

Recommended layout:

```text
/srv/apps/
└── ade-control-plane/    application checkout

/srv/ade-control-plane/
├── data/postgres/
├── backups/
├── projects/
└── logs/

/etc/ade-control-plane/
└── secrets/
```

Secrets and persistent data must not live inside the Git checkout.

## Required identities

- normal admin account for host maintenance;
- application containers running non-root;
- dedicated deployment user for #36 later;
- dedicated host runner identity when #11 is enabled.

No routine service should run as root when a narrower identity is sufficient.

## Secret inventory before start

Minimum expected secrets/configuration:

- PostgreSQL application password;
- Dashboard password hash;
- Dashboard session signing secret;
- Codex credential/auth state required by the selected runtime;
- Git credential capable of pushing only to required repositories;
- GitHub App private key + webhook secret if GitHub integration is enabled;
- runner HMAC secret only when the host runner path is enabled.

Rules:

- permissions restrictive on host files;
- no secret committed to Git;
- no secret copied into Docker image layers;
- no secret printed by deployment scripts;
- credentials independently rotatable.

## Compose acceptance before external exposure

Before adding the reverse-proxy route:

1. `docker compose config` succeeds.
2. Dashboard, worker and PostgreSQL start.
3. PostgreSQL reports healthy.
4. Worker reaches its expected idle/reconciliation state.
5. Dashboard health/read endpoint works locally.
6. PostgreSQL publishes no host port.
7. Worker publishes no host port.
8. No application container mounts `/var/run/docker.sock`.
9. `docker inspect` confirms intended users/mounts/networks.
10. Restarting containers preserves PostgreSQL state.

## Reverse proxy / Dashboard

- expose Dashboard/API only;
- TLS enabled;
- authentication verified before exposing remotely;
- direct application port should not bypass the intended access model;
- webhook path, if enabled, is the only public unauthenticated-by-session application route and remains signature-authenticated.

## Project selected for first E2E

Use a disposable or low-risk repository first.

The project must have:

- registered GitHub repository identity;
- local checkout under the allowed project root;
- clean default branch;
- push credential verified without exposing it to Codex;
- ADE/control-plane compatibility expected for the V0 path;
- a harmless test task that produces an easily reviewable change.

## First E2E procedure

1. Verify no active task exists.
2. Open Dashboard from the real external URL.
3. Select the test project.
4. Submit a small prompt.
5. Confirm task becomes `PENDING`, then `RUNNING`.
6. Confirm logs are visible and sanitized.
7. Confirm Codex runs in the expected checkout.
8. Confirm branch name matches `ade/<task-id>`.
9. Confirm only the intended repository is modified.
10. Confirm commit and push succeed.
11. Confirm a real GitHub PR is created.
12. Confirm Dashboard transitions to `SUCCESS` and shows the PR link.
13. Review the PR manually before merge.

## Failure tests before declaring #26 done

At minimum exercise:

- invalid/missing Codex credential → safe failure, no secret in logs;
- invalid repository/remote → refused before modification;
- second task while one is active → refused;
- Stop/Cancel during a long-running safe test → process stops and no unexpected PR is created;
- worker/container restart → history remains;
- full Raspberry reboot → services return and history remains.

## Backup checkpoint

Before the first real development workload:

- create one PostgreSQL backup;
- record its location and timestamp;
- verify it is non-empty/readable by the intended restore tooling;
- schedule a real restore exercise as part of #10/#9 qualification.

## Evidence to attach to #26

- Raspberry architecture/OS version;
- deployed Git SHA;
- `docker compose ps` sanitized output;
- confirmation DB/worker ports are not exposed;
- Dashboard external URL (no credentials);
- task ID used for E2E;
- resulting PR URL;
- reboot/restart validation result;
- known deviations/follow-up issues.

## Exit criterion

#26 is complete only when the real deployed flow works end to end:

```text
Dashboard on Raspberry
→ persisted task
→ real Codex
→ allowed repository
→ ade/<task-id>
→ commit/push
→ real GitHub PR
→ Dashboard SUCCESS + PR link
```
