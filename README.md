# ADE Control Plane

ADE Control Plane is the multi-project orchestration layer that supervises AI Delivery Engine (ADE) projects.

ADE remains responsible for understanding and executing work inside a single project. ADE Control Plane stays above that boundary: it decides which project should run, on which runner, under which quota policy, and exposes the global state through a dashboard and notification channels.

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
- GitHub, Discord and Slack control surfaces;
- the multi-project dashboard.

The control plane must not duplicate ADE's project delivery logic. It consumes ADE through a stable adapter/client contract.

## Target deployment

The first production target is a Raspberry Pi 5 running continuously with an SSD. The Raspberry hosts the control plane, scheduler, persistence, dashboard and lightweight execution runners. Heavy or incompatible tasks can later be dispatched to remote runners or GitHub Actions.

```text
User
  │
  ├── Dashboard
  ├── GitHub
  ├── Discord
  └── Slack
        │
        ▼
ADE Control Plane
  ├── Project Registry
  ├── Scheduler
  ├── Quota Manager
  ├── Runner Manager
  ├── Notification adapters
  └── Global persistence
        │
        ├── ADE / Project A
        ├── ADE / Project B
        └── ADE / Project C
```

## MVP

1. Register multiple ADE projects.
2. Determine which project has runnable work.
3. Check the Codex/provider quota policy.
4. Select an available runner.
5. Ask ADE to advance one unit of work.
6. Persist progress and execution events.
7. Expose status in the dashboard.
8. Pause when human input or quota reset is required.
9. Notify the user through GitHub or Discord.
10. Resume automatically after the blocking condition is resolved.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/MVP.md`](docs/MVP.md).

## Repository layout

```text
apps/
  worker/          long-running scheduler/daemon
  dashboard/       Next.js dashboard and control API
packages/
  core/            project registry and scheduler domain
  ade-client/      adapter contract between the control plane and ADE
  quota/           provider usage and quota policy
  runners/         Raspberry and future remote runner adapters
  notifications/   GitHub / Discord / Slack adapters
  database/        persistence contracts and migrations
docs/
  ARCHITECTURE.md
  MVP.md
```

## Engineering principles

- No project-specific delivery logic belongs in this repository.
- ADE is accessed through explicit, versioned contracts.
- State required for crash recovery is persisted before acknowledging a transition.
- Scheduling is deterministic and explainable.
- Quota and budget limits are hard control-plane gates, never hints to an LLM.
- Runners use least privilege and do not expose secrets to model context.
- Raspberry-first does not mean Raspberry-only: runner capabilities stay abstracted.
- The system remains usable without Discord, Slack or the web dashboard.

## Status

Initial architecture and MVP definition. Implementation starts with the project registry, ADE client contract, scheduler and persistent worker before the dashboard and chat integrations.
