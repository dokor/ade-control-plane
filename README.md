# ADE Control Plane

ADE Control Plane is the multi-project orchestration layer that supervises AI Delivery Engine (ADE) projects.

ADE remains responsible for understanding and executing work inside a single project. ADE Control Plane stays above that boundary: it decides which project should run, on which runner, under which quota policy, and exposes the global state through the Dashboard and GitHub.

The long-term product target is explicit: **orchestrate ADE across X existing or new projects**, as long as each project exposes the supported ADE control-plane entry points/capability contract. The Control Plane must not require projects to have been created by the Dashboard itself.

See [`docs/PRODUCT_TARGET.md`](docs/PRODUCT_TARGET.md) for the canonical product behavior, including the GitHub-backed multi-project work queue, human-validation behavior and 30-day Codex quota history.

## Responsibility boundary

### ADE owns

- project understanding and context packs;
- delivery graph and project-level `ProjectRun` state;
- execution loops for one task or graph node;
- agent/provider execution contracts;
- worktrees, Git changes, tests, quality gates and PR preparation;
- project-level issue/task dependencies and ordering constraints;
- project-level human decisions and delivery evidence.

### ADE Control Plane owns

- registry of managed projects, whether old or new;
- compatibility/capability checks against ADE entry points;
- scheduling and prioritization across projects;
- global provider/quota policies;
- runner selection and availability;
- pause/resume/priority controls across projects;
- global persistence and audit events;
- GitHub control and notification integration;
- the multi-project Dashboard;
- a global supervision queue built from ADE-reported runnable/waiting work references.

The control plane must not duplicate ADE's project delivery logic. It consumes ADE through a stable adapter/client contract.

## Human interfaces

The product has exactly two human-facing surfaces:

- **Dashboard** for global supervision and control, including the global runnable/waiting/attention queues and 30-day Codex quota history;
- **GitHub** for project-level interactions around issues, PRs, validations and targeted decisions.

A project waiting for human validation must not freeze the orchestrator: the scheduler can continue with runnable work from other projects and return to the blocked project when the decision is received.

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
  ├── Global Work Queue
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

## Current delivery order

The immediate goal is the smallest production V0: **Dashboard → one Codex task → branch → PR → logs**. This is a deployment milestone, not a reduction of the product target above.

Work in this order:

1. **#23** — minimal task/execution API with one active job;
2. **#24** — execute Codex locally and create the branch/commit/push/PR flow;
3. **#25** — task-oriented mobile Dashboard; it can progress in parallel with #24 after #23;
4. **#26** — Raspberry/Docker Compose deployment and real end-to-end validation;
5. **#36** — automatic `main` → Raspberry deployment through GitHub Actions after the manual runtime is proven;
6. **#1** closes when the full V0 works from Dashboard/mobile to a real GitHub PR.

After the first deployment, the roadmap resumes the full multi-project target: real Codex quota ingestion/history, GitHub-backed ADE work orchestration, human-attention flow and advanced host-runner/security hardening.

## MVP architecture capabilities

The repository already contains foundations for:

- durable PostgreSQL project/execution/control state;
- a typed ADE adapter;
- deterministic multi-project scheduling;
- crash-safe worker recovery;
- a typed secure runner protocol;
- an authenticated global supervision Dashboard;
- signed/authorized GitHub command handling.

The V0 should reuse these foundations where they reduce work, without forcing every advanced scheduler/runner/quota feature into the first deployment critical path.

See [`docs/README.md`](docs/README.md) for the design documentation index.

## Repository layout

```text
apps/
  worker/          long-running control-plane worker/recovery logic
  dashboard/       Next.js dashboard and control API
packages/
  core/            project registry and scheduler domain
  ade-client/      adapter contract between the control plane and ADE
  quota/           provider usage and quota policy
  runner-protocol/ secure Raspberry runner contract and UDS helpers
  database/        persistence contracts and migrations
deploy/
  systemd/         host-service units
docs/
  architecture, product target, security, operations and implementation contracts
```

## Engineering principles

- No project-specific delivery logic belongs in this repository.
- ADE is accessed through explicit, versioned contracts.
- Existing and new projects are equally valid when they satisfy the ADE integration contract.
- ADE determines what is runnable inside a project; the Control Plane chooses among runnable work across projects.
- GitHub issue/PR references are first-class supervision links, not a duplicate delivery graph.
- A `waiting-human` project never blocks unrelated runnable projects.
- State required for crash recovery is persisted before acknowledging a transition.
- Scheduling is deterministic and explainable.
- Quota and budget limits are hard control-plane gates, never hints to an LLM.
- Every real quota observation may be persisted as a normalized snapshot; the initial Dashboard retains/displays a rolling 30-day history.
- Runners use least privilege and do not expose secrets to model context.
- Raspberry-first does not mean Raspberry-only: runner capabilities stay abstracted.
- Dashboard and GitHub share a typed command/audit model; neither contains project-delivery rules.
- Production deployment authority for generated projects is not granted automatically in the V0.
