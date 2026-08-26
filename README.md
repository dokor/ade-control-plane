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
- global persistence and audit events;
- GitHub control and notification integration;
- the multi-project dashboard.

The control plane must not duplicate ADE's project delivery logic. It consumes ADE through a stable adapter/client contract.

## Human interfaces

The product has exactly two human-facing surfaces:

- **Dashboard** for global supervision and control;
- **GitHub** for project-level interactions around issues, PRs, validations and targeted decisions.

## Target deployment

The first production target is a Raspberry Pi 5 running continuously with an SSD. The control plane is containerized while the privileged local runner stays isolated on the Raspberry host. Heavy or incompatible tasks can later be dispatched to remote runners or GitHub Actions.

```text
User
  │
  ├── Dashboard
  └── GitHub
        │
        ▼
ADE Control Plane
  ├── Project Registry
  ├── Scheduler
  ├── Quota Manager
  ├── Runner Manager
  ├── GitHub Integration
  └── Global persistence
        │
        ▼
raspberry-local runner
  ├── ADE
  ├── Codex
  ├── Git
  └── project worktrees
```

## MVP

1. Register multiple ADE projects.
2. Determine which project has runnable work.
3. Check the Codex/provider quota policy.
4. Select an available runner.
5. Ask ADE to advance one unit of work.
6. Persist progress and execution events.
7. Expose global state and controls in the Dashboard.
8. Pause when human input or quota reset is required.
9. Use GitHub for project-level notifications and targeted commands/decisions.
10. Resume automatically after the blocking condition is resolved.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/MVP.md`](docs/MVP.md) and [`docs/SECURITY.md`](docs/SECURITY.md).

## Repository layout

```text
apps/
  worker/          long-running control-plane scheduler/daemon
  dashboard/       Next.js dashboard and control API
packages/
  core/            project registry and scheduler domain
  ade-client/      adapter contract between the control plane and ADE
  quota/           provider usage and quota policy
  runners/         Raspberry and future remote runner contracts/adapters
  github/          GitHub webhook, commands and notification integration
  security/        auth, authorization, signing/redaction helpers
  database/        persistence contracts and migrations
docs/
  ARCHITECTURE.md
  MVP.md
  SECURITY.md
```

## Engineering principles

- No project-specific delivery logic belongs in this repository.
- ADE is accessed through explicit, versioned contracts.
- State required for crash recovery is persisted before acknowledging a transition.
- Scheduling is deterministic and explainable.
- Quota and budget limits are hard control-plane gates, never hints to an LLM.
- Runners use least privilege and do not expose secrets to model context.
- Raspberry-first does not mean Raspberry-only: runner capabilities stay abstracted.
- Dashboard and GitHub share a typed command/audit model; neither contains scheduling rules.
- The system remains operable from the Dashboard even when GitHub interaction delivery is temporarily unavailable.

## Status

Initial architecture and MVP definition. Implementation starts with persistence, ADE integration, quota policy, scheduler and a crash-safe Raspberry worker before the Dashboard and GitHub control surface.
