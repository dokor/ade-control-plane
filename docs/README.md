# Documentation Index

Use this page as the entry point for design and implementation work.

## Start here

- [`../AGENTS.md`](../AGENTS.md) — mandatory instructions for Codex/automated coding agents.
- [`PRODUCT_TARGET.md`](PRODUCT_TARGET.md) — canonical product goal: orchestrate ADE across existing/new projects, GitHub-backed work queues, human gates and 30-day Codex quota history.
- [`CODEX_KICKOFF.md`](CODEX_KICKOFF.md) — ready-to-use kickoff prompts for the current implementation phases.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — responsibility boundaries and selected Raspberry topology.
- [`ADE_ADAPTER.md`](ADE_ADAPTER.md) — versioned ADE client boundary and local CLI transport contract.
- [`SCHEDULER.md`](SCHEDULER.md) — pure global scheduling gates, ranking and explainable decisions.
- [`WORKER.md`](WORKER.md) — crash-safe worker recovery, wake-ups and graceful shutdown.
- [`MVP.md`](MVP.md) — MVP scope and acceptance criteria.
- [`RELEASE_SCENARIOS.md`](RELEASE_SCENARIOS.md) — production-like #153 scenario ledger and evidence contract.
- [`FEATURES.md`](FEATURES.md) — product capabilities, MVP scope and later candidates.
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) — recommended development order.

## Core domain

- [`DATA_MODEL.md`](DATA_MODEL.md) — PostgreSQL global-state model and transactional boundaries.
- [`STATE_MACHINES.md`](STATE_MACHINES.md) — project eligibility, execution, runner, quota and command states.
- [`CONTROL_COMMANDS.md`](CONTROL_COMMANDS.md) — unified Dashboard/GitHub mutation contract.
- [`PROJECT_CONFIGURATION.md`](PROJECT_CONFIGURATION.md) — project configuration semantics.
- [`PROJECT_ONBOARDING.md`](PROJECT_ONBOARDING.md) — one compatibility/onboarding path for existing and new ADE-managed repositories.
- [`QUOTA_HISTORY.md`](QUOTA_HISTORY.md) — simple Codex quota observation, freshness and rolling 30-day retention contract.
- [`MULTI_PROJECT_ACCEPTANCE.md`](MULTI_PROJECT_ACCEPTANCE.md) — black-box acceptance scenarios for the multi-project queue/orchestrator target.

## Interfaces and execution

- [`RUNNER_PROTOCOL.md`](RUNNER_PROTOCOL.md) — secure typed worker-to-host-runner protocol.
- [`DASHBOARD.md`](DASHBOARD.md) — Dashboard information architecture and control API semantics.
- [`V0_TASK_API.md`](V0_TASK_API.md) — minimal single-active task lifecycle and HTTP API.
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — Raspberry/Docker Compose install, operations and backup procedure for V0.
- [`V0_CODEX_WORKER.md`](V0_CODEX_WORKER.md) — allow-listed Codex/Git/PR execution flow.
- [`GITHUB_INTEGRATION.md`](GITHUB_INTEGRATION.md) — GitHub App/webhook/command interaction model.
- [`GITHUB_WORK_CONTRACT.md`](GITHUB_WORK_CONTRACT.md) — versioned GitHub-first repository and work-item contract.
- [`GITHUB_APP_SETUP.md`](GITHUB_APP_SETUP.md) — minimal GitHub App permissions, webhook and actor-authorization setup.

## Security, observability and operations

- [`SECURITY.md`](SECURITY.md) — threat model and release-blocking security gates.
- [`SECRET_MATRIX.md`](SECRET_MATRIX.md) — credential ownership, separation and rotation responsibilities.
- [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) — production qualification checklist and evidence expected before release.
- [`OBSERVABILITY.md`](OBSERVABILITY.md) — audit/log/metrics/freshness contract.
- [`OPERATIONS.md`](OPERATIONS.md) — Raspberry backup/restore, upgrade and incident runbook.
- [`FIRST_DEPLOYMENT.md`](FIRST_DEPLOYMENT.md) — concrete #26 first-deployment and real E2E checklist.
- [`CD_DEPLOYMENT.md`](CD_DEPLOYMENT.md) — #36 GitHub Actions/self-hosted Raspberry deployment security model.
- [`TESTING_STRATEGY.md`](TESTING_STRATEGY.md) — test layers and mandatory failure/security scenarios.
- [`DECISIONS.md`](DECISIONS.md) — accepted architecture decisions that should not be reopened casually.

## Ownership rule

When a topic overlaps ADE and ADE Control Plane:

- project-delivery semantics, dependency ordering and project-local runnable state belong to ADE;
- multi-project selection, global queue/read models, runner/quota/control/audit belong here;
- GitHub issue/PR references may cross the boundary, but the Control Plane must not reconstruct ADE's delivery graph.

If documentation conflicts, `PRODUCT_TARGET.md`, `SECURITY.md` and the architecture boundary must be preserved until the conflict is explicitly resolved.
