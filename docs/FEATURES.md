# Feature Catalogue

## Purpose

This document defines the product capabilities of ADE Control Plane and prevents accidental scope growth during implementation.

The control plane is a **multi-project supervisor above ADE**, not an alternative delivery engine.

## MVP — Project registry

### Register a project

A trusted user can register an ADE-managed GitHub repository with:

- project name/slug;
- GitHub repository identity;
- ADE project reference;
- scheduling priority;
- runner requirements;
- optional quota-policy override.

Registration does not immediately start development. The recommended onboarding flow performs a read-only ADE health/status check before scheduling is explicitly enabled.

### Project lifecycle

A project can be:

- enabled;
- paused;
- disabled.

Historical executions/audit remain available after disablement.

## MVP — Global scheduling

### Deterministic next-project selection

The control plane selects the next eligible project based on hard gates plus explicit priority/aging.

The decision must be explainable.

### Project priority

A trusted user can reprioritize projects without modifying ADE project delivery state.

### Global scheduling mode

Modes:

- running;
- paused;
- safe mode.

Safe mode blocks new privileged dispatch while preserving observation/reconciliation/admin access.

## MVP — Quota management

### Real provider quota observation

Read normalized Codex/provider quota state when available.

### Policy gates

Policy states:

- normal;
- throttled;
- draining;
- blocked;
- unknown.

Unknown/stale data follows an explicit conservative policy.

### Reset-aware wake-up

Known reset times influence worker wake-up scheduling, but quota is always refreshed before new dispatch.

## MVP — Runner management

### Secure local runner

`raspberry-local` runs outside Docker as a host service.

The worker communicates through a Unix Domain Socket plus HMAC authentication, expiry and replay protection.

### Capability matching

Projects/work may declare required runner capabilities. The scheduler rejects incompatible runners before dispatch.

### Runner lifecycle

Runner state:

- online;
- draining;
- offline;
- disabled.

### No generic remote shell

The runner only accepts typed/versioned capabilities.

## MVP — Execution safety

### Durable intent and lease

Before privileged runner dispatch, execution intent and lease are persisted transactionally.

### Idempotent completion

Duplicate completion/result delivery cannot duplicate terminal effects.

### Unknown/reconciliation flow

Ambiguous execution outcome becomes `unknown/reconciling`; it is not blindly retried.

### Retry classification

Failures are classified:

- safe retry;
- never retry unchanged;
- reconcile first.

## MVP — Dashboard

### Global overview

Display:

- scheduler mode;
- provider quota/reset/freshness;
- runner health;
- active execution;
- attention queue;
- project status/priority/waiting reason.

### Project view

Display:

- ADE-reported stage/milestone/current/next work;
- snapshot freshness;
- execution timeline;
- scheduling decisions;
- waiting reason;
- related GitHub links;
- human decision references.

### Global/project controls

Through authenticated, audited `ControlCommand`:

- pause/resume project;
- reprioritize project;
- global pause/resume/safe-mode;
- drain/disable/enable runner;
- safe retry;
- apply known ADE decision.

### Mobile operational use

Critical status and controls remain usable from a phone.

## MVP — GitHub

### Signed webhook integration

Validate signature, delivery identity, repository mapping and actor authorization before producing internal commands/events.

### Project commands

Candidate commands:

- status;
- pause;
- resume;
- priority;
- safe retry;
- targeted ADE decision.

### Targeted notifications

Notify for meaningful project-level human attention:

- waiting-human decision;
- intervention-required failure;
- PR-ready/review state when relevant.

Global quota/runner operations remain primarily Dashboard concerns.

## MVP — Audit and observability

### Audit trail

Privileged actions must answer:

- actor/source;
- project/execution/runner;
- action;
- reason;
- authorization/result;
- correlation identity.

### Scheduler explainability

The Dashboard can explain why a project was selected or rejected.

### Health

Track safe health/freshness for:

- Database;
- worker;
- runner;
- quota snapshots;
- current execution;
- backups/disk operationally.

See `OBSERVABILITY.md`.

## MVP — Security

Security is a product feature, not invisible implementation detail.

MVP includes:

- authenticated Dashboard;
- authorized mutations;
- signed/deduplicated GitHub webhooks;
- authenticated/replay-protected runner protocol;
- project/capability allow-lists;
- workspace containment;
- least-privilege credentials;
- log/error redaction;
- Docker hardening;
- safe-mode incident control;
- tested restore/reconciliation behavior.

## Explicitly out of scope for MVP

- control-plane interpretation/copy of ADE delivery graph;
- generic chat integrations;
- automatic production deployment;
- generic remote shell execution;
- Kubernetes;
- Redis unless PostgreSQL proves insufficient;
- multi-region/distributed scheduler;
- autonomous creation of new security permissions;
- storing project source/prompts as control-plane state;
- broad cost/billing platform;
- complex team/RBAC system beyond what is required to secure the initial trusted-user deployment.

## Later candidates — only after MVP proves need

### Remote runners

- x86 homelab worker;
- GitHub Actions/ephemeral runner;
- authenticated remote transport such as mTLS.

### More scheduling policy

- per-project concurrency;
- maintenance windows;
- richer fairness/budgeting;
- runner cost/energy policy.

### Richer Dashboard

- SSE live timeline;
- historical quota charts;
- execution duration/resource trends;
- security/operations diagnostics.

### Production gates

Potentially model production handoff/approval in a later explicit security design, without granting silent production authority.

## Feature ownership test

Before adding a feature, ask:

> Does this choose/supervise/control work **across projects**, or does it decide how delivery works **inside one project**?

If it is the latter, it probably belongs in ADE.