# Implementation Plan

## Goal

Turn the current architecture skeleton into a secure Raspberry-first MVP with the shortest path to a real end-to-end execution.

The plan is intentionally vertical: every phase should leave the repository in a coherent state and reduce uncertainty for the next phase.

## Phase 0 — Foundations

Already established:

- monorepo TypeScript structure;
- ADE/control-plane responsibility boundary;
- initial scheduler domain;
- ADE client contract;
- normalized quota domain;
- bounded worker cycle;
- security model;
- Raspberry Option C architecture;
- Dashboard + GitHub as the only human interfaces.

Before deeper implementation, keep `AGENTS.md`, architecture and security docs synchronized with behavior.

## Phase 1 — Durable control-plane state (#2)

### Deliverables

- PostgreSQL package and migration runner;
- project registry persistence;
- control-plane project states: enabled / paused / disabled;
- global execution records;
- durable audit events;
- execution leases;
- recovery queries for incomplete executions;
- repository interfaces separated from SQL implementation.

### First useful schema

Implement only what the next phases need:

- `projects`;
- `project_snapshots`;
- `executions`;
- `execution_leases`;
- `audit_events`;
- `control_commands`;
- `provider_quota_snapshots`;
- `runners`.

See `DATA_MODEL.md`.

### Exit condition

Two projects can be registered, paused/resumed and survive process restart. Lease acquisition is atomic.

## Phase 2 — Real ADE boundary (#3)

### Recommended first transport

Use a local process/CLI adapter for the MVP unless ADE already exposes a more stable machine API by implementation time.

The adapter must normalize transport-specific output into the control-plane contract.

### Required operations

- status/capabilities;
- runnable-work summary;
- advance one ADE-controlled unit;
- submit a human decision;
- reconcile/inspect execution where supported.

### Important rule

The adapter may invoke ADE, but must never inspect repository internals to infer ADE state itself.

### Exit condition

One locally registered project can return a normalized status and advance one ADE-managed unit of work through a fake or real runner path.

## Phase 3 — Real Codex quota state (#4)

### Deliverables

- provider adapter isolated from quota domain;
- real quota snapshots;
- persisted snapshots;
- reset time handling;
- stale/unknown quota policy;
- policy decision recorded with scheduler/audit context.

### Exit condition

The scheduler can deterministically block new work based on real provider quota state and explain why.

## Phase 4 — Runner protocol + local Raspberry runner

This phase makes Option C real.

### Deliverables

- versioned typed worker -> runner request/response contract;
- authenticated local/private transport;
- nonce/request expiry/replay protection;
- runner registration and heartbeat;
- project allow-list;
- capability allow-list;
- workspace containment;
- execution timeout/cancellation;
- systemd unit design;
- structured/redacted runner logs.

See `RUNNER_PROTOCOL.md`.

### MVP runner capabilities

Start narrow:

- `ade.status`;
- `ade.runnable-work`;
- `ade.advance`;
- `ade.apply-decision`.

Do not expose a generic `shell.execute` capability.

### Exit condition

The containerized worker can ask the host runner to execute a typed ADE operation securely without direct host shell access.

## Phase 5 — Complete scheduler (#5)

### Inputs

- persisted project state;
- ADE runnable summary;
- quota policy;
- runner availability/capabilities;
- active leases;
- project priority;
- waiting/aging information.

### Output

A structured `SchedulerDecision` containing:

- selected project/work, if any;
- selected runner, if any;
- explicit rejection reasons for other candidates;
- quota state;
- next recommended wake-up reason/time.

### Exit condition

Given the same durable state, scheduling is deterministic and testable.

## Phase 6 — Crash-safe H24 worker (#6)

### Deliverables

- event/timer driven worker loop;
- durable lease before privileged dispatch;
- heartbeat/lease expiry;
- idempotent completion handling;
- startup reconciliation;
- backoff for infrastructure failures;
- wake-up on quota reset / control command / timer;
- graceful shutdown;
- global pause switch.

### Critical recovery rule

If the worker cannot prove whether a privileged execution completed, it must reconcile rather than blindly retry.

### Exit condition

Kill/restart tests do not duplicate completed work.

## Phase 7 — Dashboard/control API (#7)

Build after durable states exist.

See `DASHBOARD.md`.

### First pages

- `/` — global overview;
- `/projects/[id]` — project detail/timeline;
- `/runners` — runner health/capabilities;
- `/settings` — safe configuration/diagnostics.

### First mutations

- pause/resume project;
- reprioritize project;
- retry a known-safe failed control-plane operation;
- resolve/forward targeted human decision where supported;
- global scheduling pause/resume.

Every mutation creates an auditable `ControlCommand`.

### Exit condition

The complete system can be supervised from a phone without direct SSH access.

## Phase 8 — GitHub integration (#8)

See `GITHUB_INTEGRATION.md`.

### First capabilities

- signed webhook receiver;
- delivery deduplication;
- authorized actor mapping;
- project/repository mapping;
- human-required notification comments;
- status command;
- targeted decision command;
- links back to Dashboard for global state.

### Exit condition

A blocked project can request input through GitHub and resume after an authorized targeted decision.

## Phase 9 — Release security closure (#10)

Security work happens in every phase, but before H24 deployment all gates in #10 must be demonstrated.

Examples:

- authentication tests;
- webhook signature tests;
- replay tests;
- path traversal/symlink escape tests;
- redaction tests;
- Docker hardening verification;
- dependency/container/action scanning;
- backup access controls;
- credential rotation runbook.

## Phase 10 — Raspberry deployment (#9)

### Control-plane Compose

- Dashboard/control API;
- worker;
- PostgreSQL.

### Host

- `ade-control-plane-runner` systemd service;
- ADE + Codex + Git/build tools;
- dedicated Unix account;
- dedicated workspace root;
- scoped secrets.

### Exit condition

A clean Raspberry deployment can be installed, upgraded, restarted, backed up and rolled back without losing durable control-plane state.

## Recommended first Codex session

Start with **issue #2**.

Suggested session objective:

> Implement the minimal PostgreSQL persistence foundation for the project registry, execution leases and audit events described by issue #2 and `docs/DATA_MODEL.md`. Keep interfaces framework-independent, add migrations and tests, and do not implement unrelated Dashboard/GitHub features.

Then move to #3 only when #2 is green and reviewed.