# AGENTS.md

This repository contains **ADE Control Plane**, the multi-project orchestration layer above AI Delivery Engine (ADE).

These instructions apply to all automated coding agents working in this repository.

## Mission

Build a secure, always-on control plane that can supervise several ADE projects from a Raspberry Pi 5.

The control plane decides **which project may run next**, under which quota and runner constraints. ADE remains responsible for deciding **what happens inside one project**.

## Non-negotiable architecture boundary

ADE owns:

- project understanding and context;
- delivery graph and project `ProjectRun` state;
- project-level execution loops;
- project gates, validations and decisions;
- agent execution semantics;
- project worktrees, changes, tests and delivery evidence.

ADE Control Plane owns:

- project registry and global priorities;
- provider quota policy;
- runner availability and selection;
- global scheduling;
- leases and crash recovery;
- global audit events;
- Dashboard supervision/control;
- GitHub notifications and project-scoped control interactions.

Do not recreate or interpret ADE's delivery graph in this repository.

## Selected deployment architecture

The MVP uses **Option C**:

```text
Raspberry Pi 5
│
├── Docker Compose
│   ├── Dashboard / control API
│   ├── control-plane worker
│   └── PostgreSQL
│
└── host service
    └── raspberry-local runner
        ├── ADE
        ├── Codex
        ├── Git
        └── isolated project workspaces/build tooling
```

The runner is intentionally outside Docker Compose because it is the privileged execution zone.

## Human interfaces

Only two human interfaces are in scope:

1. **Dashboard** — global status and control.
2. **GitHub** — project issues, PRs, notifications and targeted decisions.

Do not introduce generic chat-channel abstractions without an explicit architecture decision.

## Security invariants

Read `docs/SECURITY.md` before changing any privileged path.

Mandatory invariants:

- no Docker socket in Dashboard or worker containers;
- no privileged containers;
- runner not publicly reachable;
- PostgreSQL not publicly reachable;
- no arbitrary shell command crossing worker -> runner;
- runner accepts typed/versioned capabilities only;
- every execution is bound to an execution ID, project ID, runner ID and lease;
- worker -> runner requests require authentication, integrity protection and replay protection;
- workspace paths must be canonicalized and contained under an allow-listed project root;
- credentials are least-privilege and independently rotatable;
- secrets must not enter prompts, logs or audit records;
- repository/issues/PR content is untrusted input;
- production credentials and automatic production deployment are absent from the MVP by default;
- fail closed when authorization, quota, lease or security state is unknown.

Security requirements in issue #10 are release-blocking.

## Development workflow

Work issue-first.

Before implementing:

1. read the target GitHub issue and its dependencies;
2. read relevant docs in `docs/`;
3. identify security boundaries touched by the change;
4. keep the change scoped to one coherent capability.

During implementation:

- prefer small typed modules over framework-heavy abstractions;
- preserve deterministic and explainable scheduling;
- external/provider-specific formats stay behind adapters;
- persist intent before performing privileged external work;
- design restart/recovery paths together with happy paths;
- treat all external data as untrusted;
- add tests for authorization, idempotency and failure paths where applicable.

Before considering work complete:

- `pnpm typecheck` passes;
- relevant tests pass;
- no architecture boundary is crossed;
- documentation/contracts are updated if externally observable behavior changed;
- security-sensitive changes include tests or verifiable configuration;
- the PR explains recovery/failure behavior when relevant.

## Implementation order

Unless a dependency forces otherwise, prefer:

1. #2 persistence / registry / leases;
2. #3 ADE adapter;
3. #4 provider quota adapter;
4. #5 runner-aware scheduler;
5. runner protocol and host runner foundation;
6. #6 crash-safe worker;
7. #7 Dashboard / control API;
8. #8 GitHub integration;
9. #10 security gates completion;
10. #9 Raspberry deployment readiness.

Security is implemented continuously, not postponed to step 9.

## Design rules

- Use TypeScript strict mode.
- Keep domain types provider/framework-independent.
- Prefer explicit state machines/enums to implicit booleans.
- Prefer PostgreSQL for durable state, leases and queue-like coordination until evidence requires another system.
- Do not add Redis or Kubernetes to the MVP without a documented reason.
- APIs must define authentication, authorization, schema, idempotency/replay behavior, timeout, audit behavior and failure mode.
- Every scheduler decision should be explainable to the Dashboard/audit log.
- Never silently retry privileged work when completion state is unknown; reconcile first.

## Important documents

- `README.md` — product overview.
- `docs/ARCHITECTURE.md` — system boundaries and deployment architecture.
- `docs/MVP.md` — MVP scope and acceptance criteria.
- `docs/SECURITY.md` — threat model and mandatory security controls.
- `docs/IMPLEMENTATION_PLAN.md` — recommended delivery sequence.
- `docs/DATA_MODEL.md` — durable global-state model.
- `docs/RUNNER_PROTOCOL.md` — control-plane/runner contract.
- `docs/GITHUB_INTEGRATION.md` — GitHub interaction design.
- `docs/DASHBOARD.md` — Dashboard information architecture and control semantics.

When repository code and documentation disagree, do not guess: preserve the documented security/architecture invariants and call out the mismatch in the PR.