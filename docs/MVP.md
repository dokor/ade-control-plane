# MVP

## Goal

Prove that one always-on Raspberry can supervise several ADE projects, respect provider quotas, survive restarts and expose useful progress without moving project-delivery responsibility out of ADE.

## End-to-end scenario

The MVP is complete when this flow works:

```text
Raspberry boots
→ worker loads registered projects
→ worker refreshes quota state
→ worker asks ADE which projects have runnable work
→ scheduler selects one project deterministically
→ worker acquires a lease
→ worker asks ADE to advance one unit of work
→ ADE executes/coordinates the project-level work
→ control plane persists the result and timeline
→ dashboard reflects the new state
→ if a human decision is required, notify and pause that project
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
- Raspberry runner registration/capabilities;
- PostgreSQL persistence;
- long-running worker with leases/restart recovery;
- read-first dashboard with project list, status, timeline and quotas;
- basic pause/resume/reprioritize controls;
- one notification/control channel, GitHub or Discord;
- Docker Compose deployment for Raspberry Pi 5/ARM64.

### Explicitly deferred

- multiple simultaneous workers across several machines;
- Kubernetes;
- Redis unless PostgreSQL proves insufficient;
- Slack before the first notification adapter is proven;
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
5. order by explicit project priority descending;
6. break ties by oldest successful execution / longest waiting time;
7. acquire a lease before dispatch.

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

## First deployment

Target Docker Compose services:

```text
worker
web
postgres
```

The existing reverse proxy on the Raspberry can terminate TLS and expose only the dashboard/API. The worker and database stay on the private Docker network.

## Acceptance criteria

- at least two projects can be registered;
- only one project is selected when a single runner slot is available;
- scheduler output includes an explainable selection reason;
- a quota block prevents dispatch and records the next eligible reset/check;
- pausing one project lets another eligible project run;
- worker restart does not duplicate completed execution;
- a human-blocked ADE project is skipped until the decision is resolved;
- dashboard shows project status, recent timeline, runner and quota state;
- a notification is emitted for a human-required state;
- Raspberry ARM64 deployment starts from Docker Compose and persists PostgreSQL data on SSD-backed storage.
