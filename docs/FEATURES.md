# Feature Catalogue

## Purpose

This document defines the product capabilities of ADE Control Plane and prevents accidental scope growth during implementation.

The control plane is a **multi-project supervisor above ADE**, not an alternative delivery engine.

The canonical target is described in `PRODUCT_TARGET.md`: orchestrate ADE across existing or new projects, as long as each project satisfies the supported ADE entry-point/capability contract.

## MVP — Project registry

### Register a project

A trusted user can register an ADE-managed GitHub repository with:

- project name/slug;
- GitHub repository identity;
- ADE project reference/entry point;
- ADE capability/version expectations;
- scheduling priority;
- runner requirements;
- optional quota-policy override.

The project may be old or new. Registration must not assume that the project was created by this control plane.

Registration does not immediately start development. The recommended onboarding flow performs a read-only ADE compatibility/health/status check before scheduling is explicitly enabled.

### Project lifecycle

A project can be:

- enabled;
- paused;
- disabled.

Historical executions/audit remain available after disablement.

## MVP — Global scheduling

### Deterministic next-work selection

The control plane selects the next eligible **ADE-reported runnable work item across all projects** based on hard gates plus explicit priority/aging.

ADE remains responsible for dependencies and ordering inside one project. The Control Plane never reconstructs the project delivery graph.

The decision must be explainable.

### Global runnable queue

The control plane maintains a derived/read-model queue of currently known runnable or waiting work references across managed projects.

Queue items may include:

- project;
- ADE work reference;
- GitHub issue/PR reference when provided by ADE;
- title/summary;
- ADE-reported order/sequence metadata when available;
- global priority;
- waiting/blocking reason;
- age/freshness.

This is not a second backlog and does not become source of truth for dependencies.

### Continue around human gates

If Project A is `waiting-human`, unrelated runnable work from Project B or C may continue.

A human gate blocks only the affected project/work item unless a global safety/quota/runner condition applies.

When a valid decision arrives through GitHub or the Dashboard, the project becomes eligible again on the next scheduling cycle.

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

Each actual successful quota observation may be stored as one normalized historical snapshot.

### 30-day history

For the initial product, retain/display a rolling **30 days** of Codex quota observations.

Minimum history values when exposed by the provider:

- used percentage;
- policy state;
- window/reset time;
- observed timestamp;
- freshness/expiry metadata.

Snapshots older than 30 days may be removed by a simple cleanup policy unless longer retention is explicitly configured later. Raw provider payloads and credentials are never retained for this feature.

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
- current Codex quota/reset/freshness;
- rolling 30-day Codex quota history;
- runner health;
- active execution/project/issue or action;
- global runnable queue;
- blocked/waiting queue;
- human-attention queue;
- project status/priority/waiting reason.

### Project view

Display:

- ADE-reported stage/milestone/current/next work;
- current and upcoming GitHub issue/action references when exposed by ADE;
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

Critical status, queue state and controls remain usable from a phone.

## MVP — GitHub

### GitHub-first project interaction

GitHub issues and PRs are the canonical external work/validation surface.

The Control Plane may carry GitHub references returned by ADE and trigger ADE with the exact runnable work reference, but it does not infer project dependencies from issue text or labels on its own.

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

### Work lifecycle

For GitHub-backed ADE projects, the normal lifecycle is:

```text
GitHub issue/backlog
→ ADE reports next runnable work
→ Control Plane places reference in global queue
→ scheduler selects eligible project/work
→ ADE executes
→ branch/PR/checks
→ human validation if needed
→ ADE exposes next runnable work
```

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

The Dashboard can explain why a project/work item was selected or rejected.

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
- control-plane inference of GitHub issue dependencies from untrusted text;
- generic chat integrations;
- automatic production deployment of the projects being developed;
- generic remote shell execution;
- Kubernetes;
- Redis unless PostgreSQL proves insufficient;
- multi-region/distributed scheduler;
- autonomous creation of new security permissions;
- storing project source/prompts as control-plane state;
- broad cost/billing platform beyond the simple 30-day quota history;
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
- execution duration/resource trends;
- security/operations diagnostics;
- quota history beyond the initial 30-day view if it proves useful.

### Production gates

Potentially model production handoff/approval in a later explicit security design, without granting silent production authority.

## Feature ownership test

Before adding a feature, ask:

> Does this choose/supervise/control work **across projects**, or does it decide how delivery works **inside one project**?

If it is the latter, it probably belongs in ADE.
