# Architecture

## Purpose

ADE Control Plane supervises multiple ADE-managed projects. It is a control plane, not a delivery engine.

ADE owns the internal delivery state and execution semantics of one project. The control plane owns global scheduling, quota policy, runner selection, user-facing supervision and crash-safe multi-project state.

## Human interfaces

The control plane has exactly two human-facing interfaces:

- **Dashboard** for global supervision and control;
- **GitHub** for project-level interactions around issues, PRs, validations and targeted decisions.

## Boundary

```text
                         Human
                  Dashboard / GitHub
                           │
                           ▼
                  ADE Control Plane
        ┌──────────────────┼──────────────────┐
        │                  │                  │
 Project Registry      Scheduler        Quota Manager
        │                  │                  │
        └─────────── Runner Manager ──────────┘
                           │
                    Runner Contract
                           │
                           ▼
                  raspberry-local
                           │
                     ADE Client API
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
          ADE Project A ADE Project B ADE Project C
```

## Source-of-truth rule

There are two distinct levels of state.

### Project delivery state

Owned by ADE:

- delivery graph;
- project `ProjectRun`;
- graph-node status;
- execution-loop attempts;
- project gates and decisions;
- task artifacts, validations and delivery evidence.

The control plane references this state but does not recreate it.

### Global supervision state

Owned by ADE Control Plane:

- registered projects and priorities;
- enabled/disabled/paused project state;
- latest known ADE status summary;
- provider quota snapshots and policy state;
- registered runners and capabilities;
- leases/locks for scheduled executions;
- global audit events;
- GitHub notification/command deliveries;
- Dashboard preferences and control commands.

## Core domains

### Project Registry

Stores the projects managed by the control plane. A project points to its repository and its ADE integration endpoint/runner configuration.

The registry contains orchestration metadata only. It does not contain the project's backlog or delivery graph.

### ADE Client

A versioned adapter isolates this repository from ADE's implementation details.

Initial conceptual operations:

```ts
interface AdeClient {
  getStatus(project: ProjectRef): Promise<AdeProjectStatus>;
  getRunnableWork(project: ProjectRef): Promise<AdeRunnableWork | null>;
  advance(project: ProjectRef, request: AdeAdvanceRequest): Promise<AdeAdvanceResult>;
  applyHumanDecision(project: ProjectRef, decision: AdeHumanDecision): Promise<void>;
}
```

The transport is deliberately unspecified initially. Local CLI/process execution can be the first adapter; HTTP/MCP or another protocol can be added later without changing scheduler semantics.

### Scheduler

The scheduler answers one question: **which project should receive the next execution slot?**

It considers only global signals:

- project enabled/paused state;
- project priority;
- whether ADE reports runnable work;
- provider/quota availability;
- compatible runner availability;
- active leases;
- optional fairness/aging rules.

It must never inspect project source code or reinterpret ADE's graph dependencies.

Every selection produces an explanation suitable for the Dashboard and audit log.

### Quota Manager

Provider quotas are control-plane gates.

The quota manager stores normalized usage snapshots and evaluates a policy such as:

- `normal`: work can start normally;
- `throttled`: reduce concurrency / prefer cheaper work;
- `draining`: finish active execution but do not start expensive work;
- `blocked`: start nothing until reset or explicit policy change.

Provider-specific data is normalized behind adapters.

### Runner Manager

A runner is an execution environment, not an AI provider.

Initial target:

- `raspberry-local` — Raspberry Pi 5 host runner, ARM64, always-on.

Future targets:

- remote x86 homelab worker;
- GitHub Actions runner;
- ephemeral cloud worker.

Each runner advertises capabilities such as architecture, memory class, Docker availability, browser/e2e support and labels. Scheduling must be able to reject incompatible work before execution.

### Worker

The worker is a long-running control-plane process. Its loop is event/timer driven rather than an unconditional busy loop.

Conceptually:

```text
wake
→ refresh quota/state
→ find runnable projects
→ acquire execution lease
→ select runner
→ submit typed runner request
→ runner asks ADE to advance
→ persist result/events
→ publish Dashboard/GitHub state when necessary
→ schedule next wake-up
```

Terminal waiting reasons include `idle`, `quota`, `human`, `runner` and `paused`.

### Dashboard

The Dashboard is the primary global view/control surface over persisted global state plus ADE summaries.

It should show:

- projects and overall delivery progress;
- current and next work;
- waiting/blocking reasons;
- milestones/stages as reported by ADE;
- active runner;
- quota snapshots and reset information;
- execution timeline;
- human decisions requiring attention.

Control actions include pause, resume, reprioritize, retry and handoff/takeover where supported.

### GitHub Integration

GitHub is the only external project interaction surface.

It handles:

- signed webhooks;
- project-scoped notifications on issues/PRs;
- typed control commands such as status, pause, resume, retry, priority and decision;
- authorization based on actor/repository permissions;
- idempotency and webhook delivery deduplication;
- links back to the Dashboard for global state.

No scheduling rule belongs in the GitHub integration.

## Persistence

Target persistence for the Raspberry deployment is PostgreSQL. Queue/lease semantics should initially be implemented with PostgreSQL as well to avoid adding Redis without a demonstrated need.

Likely entities:

- `projects`;
- `project_snapshots`;
- `provider_quota_snapshots`;
- `runners`;
- `execution_leases`;
- `executions`;
- `control_commands`;
- `audit_events`;
- `github_deliveries`.

## Failure and restart model

The Raspberry may restart at any time. The architecture assumes restartability:

1. persist intent/lease before starting an external execution;
2. persist ADE execution identity when available;
3. on restart, reconcile incomplete executions rather than blindly replaying them;
4. never start two executions for the same leased work;
5. retain enough audit evidence to explain a recovery decision.

## Security principles

Security is a design constraint, not a later hardening phase.

- least privilege for every GitHub/provider/runner credential;
- deny-by-default network and command capabilities;
- explicit trust boundaries between Dashboard, worker, database, runner, ADE, GitHub and providers;
- secret references rather than secret values in model-visible state;
- redact logs before persistence/display;
- no production deployment authority by default;
- Dashboard and GitHub commands must authenticate the actor and map to explicit permissions;
- ADE retains responsibility for project-level workspace/tool permissions;
- runner APIs must use authenticated, integrity-protected requests and replay protection;
- no Docker socket mounted into Dashboard or control-plane worker;
- no direct host shell access from the public-facing Dashboard;
- no arbitrary command strings crossing the control-plane/runner boundary: only typed, versioned commands;
- all privileged actions must be auditable with actor, project, runner, reason and result;
- credentials must be scoped per integration where possible and independently rotatable.

See `docs/SECURITY.md` for the threat model and mandatory controls.

## Raspberry deployment target — selected architecture

The selected MVP architecture is **Option C: containerized control plane + isolated host runner**.

```text
Raspberry Pi 5
│
├── Docker Compose — control plane trust zone
│   ├── Dashboard / control API
│   ├── control-plane worker
│   └── PostgreSQL
│
├── existing reverse proxy
│       └── exposes Dashboard/control API only
│
└── host runner trust zone
    └── raspberry-local runner service
        ├── ADE
        ├── Codex
        ├── Git
        ├── project worktrees
        └── project build/test tooling
```

### Why the runner stays outside the control-plane containers

The runner needs materially stronger privileges than the Dashboard or scheduler: local repositories, Git credentials, subprocesses, build tools and potentially Docker/browser capabilities. Keeping it outside the control-plane containers prevents those privileges from leaking into the public-facing application or scheduler process.

The control plane must never obtain the runner's generic shell privileges. It can only submit a constrained execution contract to the runner.

### Network boundaries

- PostgreSQL is reachable only from trusted control-plane services.
- The runner exposes no public internet endpoint.
- Dashboard/API is the only externally reachable application component and sits behind the existing reverse proxy/TLS layer.
- Worker-to-runner communication uses a dedicated authenticated local/private channel.
- Provider/GitHub outbound access originates only from components that need it.
- Database, runner management endpoints and internal health endpoints are never published directly.

### Runner boundary contract

The runner receives structured requests similar to:

```text
executionId
projectId
ADE command/capability
workspace reference
allowed capability set
timeout / budget
correlation nonce
```

It does **not** accept arbitrary remote shell commands such as `command: "..."`.

The runner validates:

- caller identity;
- request signature/token;
- nonce / replay protection;
- lease/execution identity;
- project allow-list;
- requested capability;
- workspace path containment;
- timeout and resource policy.

### Container hardening target

For Dashboard and worker containers:

- run as non-root;
- read-only root filesystem where practical;
- `no-new-privileges`;
- drop Linux capabilities by default;
- no `/var/run/docker.sock` mount;
- no host filesystem mounts except narrowly scoped persistent/config volumes;
- secrets provided through dedicated secret files/environment injection, never committed;
- healthchecks without sensitive data;
- resource limits where practical.

Redis, Kubernetes and distributed orchestration are intentionally not MVP dependencies.
