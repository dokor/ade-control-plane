# Documentation Index

Use this page as the entry point for design and implementation work.

## Start here

- [`../AGENTS.md`](../AGENTS.md) — canonical provider-neutral instructions for Codex, Claude Code and other automated coding agents.
- [`PRODUCT_TARGET.md`](PRODUCT_TARGET.md) — canonical product goal: orchestrate ADE across existing/new projects, GitHub-backed work queues, human gates and provider usage/quota history.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — responsibility boundaries and selected Raspberry topology.
- [`ADE_ADAPTER.md`](ADE_ADAPTER.md) — versioned ADE client boundary and local CLI transport contract.
- [`AGENT_EXECUTORS.md`](AGENT_EXECUTORS.md) — shared coding-provider adapter contract and publication boundary.
- [`ADE_RUNTIME.md`](ADE_RUNTIME.md) — pinned ADE runtime, setup/readiness and validation/review contract.
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
- [`PROJECT_ONBOARDING.md`](PROJECT_ONBOARDING.md) — one compatibility/onboarding path for existing and new ADE-managed repositories, including root `AGENTS.md` setup.
- [`QUOTA_HISTORY.md`](QUOTA_HISTORY.md) — provider quota observation, freshness and retention contract.
- [`MULTI_PROJECT_ACCEPTANCE.md`](MULTI_PROJECT_ACCEPTANCE.md) — black-box acceptance scenarios for the multi-project queue/orchestrator target.

## Interfaces and execution

- [`AGENT_EXECUTORS.md`](AGENT_EXECUTORS.md) — `AgentExecutor` abstraction, Codex/Claude Code adapters, normalized usage and provider-neutral ADE boundary.
- [`V0_CODEX_WORKER.md`](V0_CODEX_WORKER.md) — historical filename for the V0 agent-worker implementation guide; now documents both Codex and Claude Code.
- [`RUNNER_PROTOCOL.md`](RUNNER_PROTOCOL.md) — secure typed worker-to-host-runner protocol.
- [`DASHBOARD.md`](DASHBOARD.md) — Dashboard information architecture and control API semantics.
- [`V0_TASK_API.md`](V0_TASK_API.md) — minimal single-active task lifecycle and HTTP API.
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — Raspberry/Docker Compose install, operations and backup procedure.
- [`GITHUB_INTEGRATION.md`](GITHUB_INTEGRATION.md) — GitHub App/webhook/command interaction model.
- [`GITHUB_WORK_CONTRACT.md`](GITHUB_WORK_CONTRACT.md) — versioned GitHub-first repository and work-item contract.
- [`GITHUB_APP_SETUP.md`](GITHUB_APP_SETUP.md) — minimal GitHub App permissions, webhook and actor-authorization setup.

## Provider-neutral execution model

The coding provider is an execution adapter, not the owner of the delivery workflow.

```text
ADE issue lifecycle + implementation handoff
                ↓
       AgentExecutor abstraction
          ↙             ↘
       Codex         Claude Code
          ↘             ↙
        workspace changes
                ↓
    ADE validation / reviews
                ↓
 Control Plane commit / push / PR
                ↓
       explicit human merge
```

All prepared repositories should expose a root `AGENTS.md` as the common agent instruction contract. Provider-specific files such as `CLAUDE.md` may defer to it but must not maintain a second ADE workflow.

Changing providers must not change readiness, scope, specialist profiles, validation, publication ownership or the human merge gate.

## Security, observability and operations

- [`SECURITY.md`](SECURITY.md) — threat model and release-blocking security gates.
- [`SECRET_MATRIX.md`](SECRET_MATRIX.md) — credential ownership, separation and rotation responsibilities.
- [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) — production qualification checklist and evidence expected before release.
- [`OBSERVABILITY.md`](OBSERVABILITY.md) — audit/log/metrics/freshness contract.
- [`OPERATIONS.md`](OPERATIONS.md) — Raspberry backup/restore, upgrade and incident runbook.
- [`FIRST_DEPLOYMENT.md`](FIRST_DEPLOYMENT.md) — concrete first-deployment and real E2E checklist.
- [`CD_DEPLOYMENT.md`](CD_DEPLOYMENT.md) — GitHub Actions/self-hosted Raspberry deployment security model.
- [`TESTING_STRATEGY.md`](TESTING_STRATEGY.md) — test layers and mandatory failure/security scenarios.
- [`DECISIONS.md`](DECISIONS.md) — accepted architecture decisions that should not be reopened casually.

## Ownership rule

When a topic overlaps ADE and ADE Control Plane:

- project-delivery semantics, readiness, implementation handoffs, profiles, skills, rules and review/correction gates belong to ADE;
- coding-provider invocation is a Control Plane adapter concern, but provider choice must not fork ADE semantics;
- multi-project selection, global queue/read models, runner/quota/control/audit and GitHub publication/reconciliation belong here;
- GitHub issue/PR references may cross the boundary, but the Control Plane must not reconstruct ADE's delivery graph.

If documentation conflicts, the structured ADE contract for the current execution, `../AGENTS.md`, `PRODUCT_TARGET.md`, `SECURITY.md` and the architecture boundary must be preserved until the conflict is explicitly resolved.
