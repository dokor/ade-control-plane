# Raspberry Operations Runbook

## Purpose

Define the operational model for the always-on Raspberry deployment before deployment code is finalized.

The MVP must be easy to install and recover without relying on direct database edits or undocumented shell procedures.

## Target topology

```text
Raspberry Pi 5
│
├── Docker Compose
│   ├── Dashboard / control API
│   ├── worker
│   └── PostgreSQL
│
├── reverse proxy / TLS
│
└── systemd
    └── ade-control-plane-runner
```

Persistent data and runner workspaces should live on SSD-backed storage.

## Filesystem target

Exact paths can be adapted to the host, but keep concerns separated.

Example:

```text
/srv/ade-control-plane/
├── compose/              application checkout/config
├── data/
│   └── postgres/         database volume
├── backups/              protected DB backups
└── runner/
    ├── config/           runner non-secret config
    ├── projects/         canonical project roots
    ├── workspaces/       execution workspaces if separated
    └── state/            runner-owned recovery state
```

Secrets should use a separate protected location/runtime injection path with restrictive permissions.

## Unix identities

Recommended separation:

- normal administrator account for maintenance;
- dedicated runner service account for ADE/Codex/Git execution;
- Docker services run as non-root users inside containers;
- database has its own database credentials.

Do not run the host runner as root.

## Network exposure

Public/LAN exposed through reverse proxy:

- Dashboard/control API only.

Not publicly exposed:

- PostgreSQL;
- worker;
- runner management endpoint/socket;
- internal health/metrics endpoints unless deliberately protected.

Firewall should allow only required administration/reverse-proxy services.

## First installation target

Eventually the documented installation should be close to:

```bash
git clone <repo>
cd ade-control-plane
cp .env.example .env
# configure non-secret settings / secret references
docker compose pull || true
docker compose build
docker compose up -d
sudo systemctl enable --now ade-control-plane-runner
```

Do not publish these commands as final until Compose/systemd files exist and are tested.

## Startup order

1. PostgreSQL becomes healthy;
2. Dashboard/control API starts;
3. worker starts and enters reconciliation before scheduling;
4. host runner starts/registers/heartbeats;
5. worker observes healthy runner;
6. scheduling starts only if global mode and security/quota gates allow it.

A worker restart must not assume the runner or prior execution disappeared.

## Shutdown

Graceful maintenance sequence:

1. global scheduler pause;
2. allow active execution to finish or explicitly cancel through typed execution cancellation;
3. verify no execution remains `unknown`;
4. stop worker/Dashboard if needed;
5. stop runner when host maintenance requires it;
6. PostgreSQL remains available until application state is flushed.

For emergency response, safe mode + runner stop may take precedence.

## Upgrade

Target upgrade flow:

1. global scheduling pause;
2. database backup;
3. pull release/commit;
4. build/pull images;
5. run migration compatibility check;
6. apply migrations;
7. recreate containers;
8. restart/update runner service if runner code changed;
9. verify DB/API/runner health;
10. verify reconciliation complete;
11. resume scheduling.

Migrations must be forward-safe for the version being deployed. Rollback strategy is documented per migration when destructive changes exist.

## Backups

Minimum backup scope:

- PostgreSQL durable state;
- non-secret project/runner configuration;
- optionally runner recovery metadata required to reconcile executions.

Project Git repositories generally have GitHub/remotes as source of truth, but unpushed worktree state during active execution may require runner recovery semantics rather than being treated as backup data.

### Database backup properties

- stored on SSD and preferably copied off-device periodically;
- access-controlled;
- encrypted if copied to less-trusted storage;
- retention policy defined;
- restore tested, not merely backup creation.

Never assume a backup works until a restore has been exercised.

## Restore

Target restore procedure:

1. stop scheduling/worker;
2. ensure runner cannot start new work;
3. restore PostgreSQL into a clean/known instance;
4. start Dashboard read-only if useful;
5. start worker in reconciliation/safe mode;
6. reconcile non-terminal executions against runner/ADE state;
7. inspect audit timeline;
8. resume scheduling only after state consistency is confirmed.

A database restore may make external runner/ADE state newer than the database; reconciliation is therefore mandatory.

## Monitoring

Minimum operational health signals:

- Dashboard/API health;
- worker heartbeat/last cycle;
- PostgreSQL health;
- runner heartbeat;
- current execution age;
- number of unknown/reconciling executions;
- provider quota snapshot age;
- disk free space;
- backup age.

Avoid collecting secrets or full prompts/source in metrics.

## H24 host qualification

After a deployment has started normally, run the repository-provided,
read-only qualification command on the Raspberry:

```bash
/opt/ade-control-plane/deploy/bin/qualify-h24 --require-backup
```

It verifies the resolved Compose configuration, healthchecks, non-root and
read-only application containers, dropped capabilities, private PostgreSQL and
worker ports, absence of Docker socket mounts, loopback Dashboard binding, and
the active `ade-runner` systemd service with its UDS socket. It only reports
pass/fail facts and never reads secret contents or database rows.

This command is evidence, not a replacement for the required restore exercise:
use the restore sequence above with a disposable/known instance, then retain a
sanitized record of the deployed SHA, backup timestamp, reconciliation result
and approving operator in the #9 sign-off.

## Disk pressure

The control plane should detect/report low disk space before Git worktrees, PostgreSQL or logs exhaust the SSD.

Operational policy should cover:

- log retention;
- old execution workspace cleanup;
- old container image cleanup;
- PostgreSQL backup retention;
- minimum free-space threshold that blocks new execution if unsafe.

## Log handling

- structured logs;
- centralized redaction;
- bounded retention;
- no tokens/environment dumps;
- runner logs separated from control-plane application logs;
- correlation IDs connect logs to `execution_id` without storing sensitive payloads.

## Secret rotation

Each credential must be independently rotatable:

- Dashboard/session/auth secret;
- worker-runner authentication secret/certificate;
- PostgreSQL credentials;
- GitHub App/webhook credentials;
- Codex/provider credentials;
- runner Git credentials if separate.

Rotation should not require replacing unrelated secrets.

## Incident response

Minimum emergency controls:

1. set global scheduler to safe mode/pause;
2. disable runner in control plane;
3. stop runner systemd service if needed;
4. revoke affected external credential;
5. preserve audit/database state;
6. inspect recent privileged executions and affected projects;
7. rotate credentials independently;
8. restore/reconcile as necessary;
9. resume with explicit administrative action.

## No-SSH operational goal

Routine supervision should happen through the Dashboard/GitHub.

SSH remains an administrative break-glass/maintenance path, not the normal way to:

- pause projects;
- inspect scheduling status;
- check quota;
- resolve expected project decisions;
- view normal execution status.
