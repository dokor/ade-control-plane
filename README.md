# ADE Control Plane

ADE Control Plane is the multi-project orchestration layer that supervises AI Delivery Engine (ADE) projects.

ADE remains responsible for understanding and executing work inside a single project. ADE Control Plane stays above that boundary: it decides which project should run, on which runner, under which quota policy, and exposes the global state through the Dashboard and GitHub.

## Responsibility boundary

### ADE owns

- project understanding and context packs;
- delivery graph and project-level `ProjectRun` state;
- execution loops for one task or graph node;
- agent/provider execution contracts;
- worktrees, Git changes, tests, quality gates and PR preparation;
- project-level human decisions and delivery evidence.

### ADE Control Plane owns

- registry of managed projects;
- scheduling and prioritization across projects;
- global provider/quota policies;
- runner selection and availability;
- pause/resume/priority controls across projects;
- global persistence, leases and audit events;
- GitHub control and notification integration;
- the multi-project Dashboard.

The control plane must not duplicate ADE's project delivery logic. It consumes ADE through a stable adapter/client contract.

## Human interfaces

The product has exactly two human-facing surfaces:

- **Dashboard** for global supervision and control;
- **GitHub** for project-level interactions around issues, PRs, validations and targeted decisions.

## Target deployment

The first production target is a Raspberry Pi 5 running continuously with an SSD.

The selected architecture keeps the privileged execution runner outside the control-plane containers:

```text
User
  │
  ├── Dashboard
  └── GitHub
        │
        ▼
Docker Compose
  ├── Dashboard / control API
  ├── control-plane worker
  └── PostgreSQL
        │
        │ typed + authenticated runner protocol
        ▼
Host: raspberry-local runner
  ├── ADE
  ├── Codex
  ├── Git
  └── isolated project workspaces/build tooling
```

The worker never receives generic host-shell or Docker-socket privilege.

## MVP

1. Register multiple ADE projects.
2. Persist global control state, leases and audit history in PostgreSQL.
3. Ask ADE which projects have runnable work through a stable adapter.
4. Read real provider/Codex quota state and apply deterministic quota policy.
5. Select a compatible runner/project deterministically.
6. Dispatch typed ADE capabilities to the secure host runner.
7. Survive crashes/restarts through reconciliation without duplicate privileged work.
8. Expose global state and controls in the Dashboard.
9. Use GitHub for project-level notifications and targeted commands/decisions.
10. Deploy the control plane through Docker Compose and the runner through systemd on Raspberry Pi 5.

## Start developing

For Codex or any automated coding agent, read [`AGENTS.md`](AGENTS.md) first.

Recommended first implementation task: **GitHub issue #2 — PostgreSQL persistence / project registry / leases / audit**.

Then follow [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

Persistence commands:

- `pnpm --filter @ade-control-plane/database migrate` applies versioned PostgreSQL migrations using `DATABASE_URL` or `DATABASE_URL_FILE`.
- `pnpm --filter @ade-control-plane/database test` runs the PostgreSQL integration suite when `TEST_DATABASE_URL` is set.

## Documentation

The complete documentation index is in [`docs/README.md`](docs/README.md).

Core references:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — boundaries and topology;
- [`docs/MVP.md`](docs/MVP.md) — MVP acceptance criteria;
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model and release-blocking gates;
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — durable state and transactions;
- [`docs/STATE_MACHINES.md`](docs/STATE_MACHINES.md) — explicit execution/recovery states;
- [`docs/RUNNER_PROTOCOL.md`](docs/RUNNER_PROTOCOL.md) — privileged host boundary;
- [`docs/DASHBOARD.md`](docs/DASHBOARD.md) — global control surface;
- [`docs/GITHUB_INTEGRATION.md`](docs/GITHUB_INTEGRATION.md) — project interaction surface;
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — Raspberry operations/runbook;
- [`docs/TESTING_STRATEGY.md`](docs/TESTING_STRATEGY.md) — mandatory crash/security scenarios;
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — accepted architecture decisions.

## Repository layout

```text
apps/
  worker/          long-running control-plane scheduler/daemon
  dashboard/       Next.js Dashboard and control API
packages/
  core/            project registry and scheduler domain
  ade-client/      adapter contract between the control plane and ADE
  quota/           provider usage and quota policy
  runners/         secure runner contracts/adapters
  github/          GitHub webhook, commands and notification integration
  security/        auth, authorization, signing/redaction helpers
  database/        persistence contracts and migrations
docs/
  ...              architecture, contracts, security and operations
```

Some packages/apps are planned and will be created by their implementation issues rather than as empty abstractions.

## Engineering principles

- No project-specific delivery logic belongs in this repository.
- ADE is accessed through explicit, versioned contracts.
- State required for crash recovery is persisted before acknowledging a privileged transition.
- Scheduling is deterministic and explainable.
- Quota and budget limits are hard control-plane gates, never hints to an LLM.
- Runners use least privilege and do not expose secrets to model context.
- Raspberry-first does not mean Raspberry-only: runner capabilities stay abstracted.
- Dashboard and GitHub share a typed command/audit model; neither contains scheduling rules.
- Ambiguous execution outcome becomes `unknown/reconciling`, never an automatic retry.
- Security issue #10 is release-blocking for the H24 deployment.

## Current backlog

- #1 — MVP epic;
- #2 — persistence / registry / leases / audit;
- #3 — ADE adapter;
- #4 — Codex/provider quota adapter;
- #5 — runner-aware scheduler;
- #6 — crash-safe H24 worker;
- #7 — Dashboard/control API;
- #8 — GitHub commands/notifications;
- #9 — Raspberry Docker Compose deployment;
- #10 — security architecture and release gates;
- #11 — secure host runner/protocol.

## Status

Architecture, threat model, implementation plan, durable-state model, runner protocol, Dashboard/GitHub contracts, operations runbook and testing strategy are prepared. The next code milestone is issue #2.
