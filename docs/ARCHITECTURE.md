# Architecture

## Purpose

ADE Control Plane supervises multiple ADE-managed projects. It is a control plane, not a delivery engine.

ADE owns the internal delivery state and execution semantics of one project. The control plane owns global scheduling, quota policy, runner selection, user-facing supervision and crash-safe multi-project state.

## Boundary

```text
                         Human
            Dashboard / GitHub / Discord / Slack
                           │
                           ▼
                  ADE Control Plane
        ┌──────────────────┼──────────────────┐
        │                  │                  │
 Project Registry      Scheduler        Quota Manager
        │                  │                  │
        └─────────── Runner Manager ──────────┘
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
- global audit events and notifications;
- dashboard preferences and control commands.

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

Every selection produces an explanation suitable for the dashboard and audit log.

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

- `raspberry-local` — Raspberry Pi 5 worker, ARM64, always-on.

Future targets:

- remote x86 homelab worker;
- GitHub Actions runner;
- ephemeral cloud worker.

Each runner advertises capabilities such as architecture, memory class, Docker availability, browser/e2e support and labels. Scheduling must be able to reject incompatible work before execution.

### Worker

The worker is a long-running process. Its loop is event/timer driven rather than an unconditional busy loop.

Conceptually:

```text
wake
→ refresh quota/state
→ find runnable projects
→ acquire execution lease
→ select runner
→ ask ADE to advance
→ persist result/events
→ notify if necessary
→ schedule next wake-up
```

Terminal waiting reasons include `idle`, `quota`, `human`, `runner` and `paused`.

### Dashboard

The dashboard is a view/control surface over persisted global state plus ADE summaries.

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

### Notifications

GitHub, Discord and Slack are adapters over the same event and command model. No orchestration rule belongs in a channel adapter.

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
- `notification_deliveries`.

## Failure and restart model

The Raspberry may restart at any time. The architecture assumes restartability:

1. persist intent/lease before starting an external execution;
2. persist ADE execution identity when available;
3. on restart, reconcile incomplete executions rather than blindly replaying them;
4. never start two executions for the same leased work;
5. retain enough audit evidence to explain a recovery decision.

## Security principles

- least privilege for GitHub/provider credentials;
- secret references rather than secret values in model-visible state;
- redact logs before persistence/display;
- no production deployment authority by default;
- channel commands must authenticate the actor and map to explicit permissions;
- ADE retains responsibility for project-level workspace/tool permissions.

## Raspberry deployment target

The first deployment should remain small:

```text
Docker Compose
├── control-plane-worker
├── dashboard
├── postgres
└── reverse-proxy (existing infrastructure may provide this)
```

Redis, Kubernetes and distributed orchestration are intentionally not MVP dependencies.
