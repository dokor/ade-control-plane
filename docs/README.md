# Documentation Index

Use this page as the entry point for design and implementation work.

## Start here

- [`../AGENTS.md`](../AGENTS.md) — mandatory instructions for Codex/automated coding agents.
- [`CODEX_KICKOFF.md`](CODEX_KICKOFF.md) — ready-to-use kickoff prompts for issue #2 and later phases.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — responsibility boundaries and selected Raspberry topology.
- [`MVP.md`](MVP.md) — MVP scope and acceptance criteria.
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) — recommended development order.

## Core domain

- [`DATA_MODEL.md`](DATA_MODEL.md) — PostgreSQL global-state model and transactional boundaries.
- [`STATE_MACHINES.md`](STATE_MACHINES.md) — project eligibility, execution, runner, quota and command states.
- [`PROJECT_CONFIGURATION.md`](PROJECT_CONFIGURATION.md) — project onboarding/configuration semantics.

## Interfaces and execution

- [`RUNNER_PROTOCOL.md`](RUNNER_PROTOCOL.md) — secure typed worker-to-host-runner protocol.
- [`DASHBOARD.md`](DASHBOARD.md) — Dashboard information architecture and control API semantics.
- [`GITHUB_INTEGRATION.md`](GITHUB_INTEGRATION.md) — GitHub App/webhook/command interaction model.

## Security and operations

- [`SECURITY.md`](SECURITY.md) — threat model and release-blocking security gates.
- [`OPERATIONS.md`](OPERATIONS.md) — Raspberry deployment, backup/restore, upgrade and incident runbook.
- [`TESTING_STRATEGY.md`](TESTING_STRATEGY.md) — test layers and mandatory failure/security scenarios.
- [`DECISIONS.md`](DECISIONS.md) — accepted architecture decisions that should not be reopened casually.

## Ownership rule

When a topic overlaps ADE and ADE Control Plane:

- project-delivery semantics belong to ADE;
- multi-project scheduling/control/runner/quota/audit belongs here.

If documentation conflicts, `SECURITY.md` and the architecture boundary must be preserved until the conflict is explicitly resolved.