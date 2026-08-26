# MVP

## Goal

Prove that one always-on Raspberry can supervise several ADE projects, respect provider quotas, survive restarts and expose useful progress without moving project-delivery responsibility out of ADE.

## Human interfaces

The MVP exposes exactly two human-facing interfaces:

- **Dashboard** for global supervision and control;
- **GitHub** for project-level interactions around issues, PRs, validations and targeted decisions.

## End-to-end scenario

The MVP is complete when this flow works:

```text
Raspberry boots
→ worker loads registered projects
→ worker refreshes quota state
→ worker asks ADE which projects have runnable work
→ scheduler selects one project deterministically
→ worker acquires a lease
→ worker selects the host runner
→ worker asks ADE to advance one unit of work
→ ADE executes/coordinates the project-level work through the runner
→ control plane persists the result and timeline
→ Dashboard reflects the new state
→ if a targeted human decision is required, expose it in Dashboard and/or GitHub
→ otherwise select the next project
→ if quota policy blocks new work, wait until reset
→ after restart, reconcile and resume without replaying completed work
```

## MVP scope

### Included

- monorepo TypeScript;
- project registry;
- ADE client contract and local adapter;
- deterministic multi-project scheduler;
- normalized quota model and policy engine;
- Raspberry host runner registration/capabilities;
- PostgreSQL persistence;
- long-running worker with leases/restart recovery;
- Dashboard with project list, status, timeline, quotas and control actions;
- pause/resume/reprioritize controls;
- GitHub integration for project-level notifications, commands and targeted decisions;
- Docker Compose deployment for the control plane on Raspberry Pi 5/ARM64;
- isolated runner service on the Raspberry host;
- security release gates from `docs/SECURITY.md`.

### Explicitly deferred

- multiple simultaneous workers across several machines;
- Kubernetes;
- Redis unless PostgreSQL proves insufficient;
- automatic production deployment;
- control-plane interpretation of ADE delivery graphs;
- control-plane prompts or specialist agents;
- complex billing/cost accounting;
- advanced fairness algorithms.

## Initial scheduling policy

For the first implementation, keep selection explainable:

1. discard disabled or paused projects;
2. discard projects for which ADE reports no runnable work;
3. discard projects blocked by global quota policy;
4. discard projects with no compatible available runner;
5. discard work with an active lease;
6. order by explicit project priority descending;
7. break ties by oldest successful execution / longest waiting time;
8. acquire a lease before dispatch.

The selected project records a human-readable selection reason.

## Initial quota policy

Use normalized thresholds configurable per provider/account. A reasonable default for Codex-style windows:

| Usage | State | Behaviour |
| --- | --- | --- |
| < 70% | normal | normal scheduling |
| 70–85% | throttled | single execution, avoid low-priority work |
| 85–95% | draining | finish current work, only short/high-priority work |
| >= 95% | blocked | start nothing until reset |

These thresholds are policy, not assumptions about provider guarantees, and must remain configurable.

## Dashboard V1

### Global view

- provider quota gauges and reset time;
- runner health;
- projects ordered by current scheduling priority;
- current status: running, ready, waiting-human, waiting-quota, paused, failed, completed;
- current work and next work summary from ADE;
- latest event and last successful execution.

### Project view

- ADE-reported delivery stage/milestone;
- current node/task;
- global scheduling state;
- execution timeline;
- waiting reason;
- quota/runner used for recent executions;
- pause/resume and priority controls;
- link to repository/PR/decision when available.

## GitHub V1

GitHub complements the Dashboard instead of duplicating it.

It should support:

- targeted notifications on issues/PRs when human input is required;
- status, pause, resume, retry, priority and decision commands where appropriate;
- actor authorization and repository scoping;
- signed/deduplicated webhook processing;
- links back to the Dashboard for global state and controls.

## First deployment

Target architecture:

```text
Docker Compose
├── dashboard / control API
├── control-plane worker
└── PostgreSQL

Raspberry host
└── raspberry-local runner
    ├── ADE
    ├── Codex
    ├── Git
    └── project worktrees/build tooling
```

The reverse proxy terminates TLS and exposes only the Dashboard/control API. PostgreSQL and worker stay private. The runner is a separate host service and is never publicly exposed.

## Acceptance criteria

- at least two projects can be registered;
- only one project is selected when a single runner slot is available;
- scheduler output includes an explainable selection reason;
- a quota block prevents dispatch and records the next eligible reset/check;
- pausing one project lets another eligible project run;
- worker restart does not duplicate completed execution;
- a human-blocked ADE project is skipped until the decision is resolved;
- Dashboard shows project status, recent timeline, runner and quota state;
- GitHub can surface and resolve at least one targeted human-required state;
- the control plane starts from Docker Compose on Raspberry ARM64 and persists PostgreSQL data on SSD-backed storage;
- the isolated host runner can be restarted independently and reconciles safely with the control plane;
- mandatory security gates are satisfied before the deployment is considered H24-ready.
