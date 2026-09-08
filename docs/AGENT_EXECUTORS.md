# Agent executors

ADE Control Plane exposes one provider-neutral `AgentExecutor` contract for implementation work. The executor receives a bounded ADE-approved prompt through stdin and returns the command result, streamed output and provider usage when available.

The provider does **not** own ADE lifecycle semantics. ADE remains responsible for issue admission, the structured implementation handoff, validation and specialist review policy. Control Plane remains responsible for scheduling, persistence, Git/GitHub side effects and publication.

## Supported providers

`V0_AGENT_PROVIDER` selects the implementation:

- `codex` (default): `codex exec --sandbox workspace-write --ephemeral --json -`
- `claude-code`: `claude --print --output-format json`

Both providers run inside the same checkout/workspace lifecycle and receive the same ADE implementation contract. Provider selection changes the executable adapter, not the delivery workflow.

There is no automatic fallback between providers. A provider failure stays a failure and cannot be silently retried on another provider, because that would make execution provenance and quota accounting ambiguous.

## Canonical repository instructions

Projects prepared for ADE should expose a root `AGENTS.md` as the canonical provider-neutral coding-agent instruction file.

Provider-specific instruction files may exist only as adapters. For example, `CLAUDE.md` may direct Claude Code to read `AGENTS.md`, but it should not maintain a second copy of ADE workflow semantics.

The provider receives, in order of authority:

1. the structured ADE handoff for the current execution;
2. the repository `AGENTS.md` contract;
3. repository-local skills/documentation referenced by ADE;
4. free-form issue prose as reference material only.

This keeps Codex, Claude Code and future providers aligned on the same readiness gates, scope, reviews and human approval boundary.

## Execution boundary

The executor is intentionally narrow:

```text
ADE lifecycle / handoff
        ↓
AgentExecutor
        ↓
Codex OR Claude Code
        ↓
workspace changes
        ↓
ADE validation / specialist reviews
        ↓
Control Plane commit / push / PR
        ↓
human review / merge
```

When the worker prompt states that Control Plane owns publication, the provider must not:

- commit;
- push;
- create a pull request;
- mutate GitHub issue metadata;
- merge.

The provider may edit files only inside its assigned workspace and run commands needed to satisfy the ADE-approved handoff.

## Issue enrichment

ADE may return an `enrich` action before development. In that mode the selected provider receives ADE's bounded enrichment prompt and must return an improved issue body. It must not modify repository files.

After enrichment, Control Plane updates the issue and asks ADE to re-plan it. Development starts only if ADE then returns a validated `ade.implementation-handoff/v1` action.

The same enrichment path is used for Codex and Claude Code.

## Validation and reviews

After implementation the provider result is not considered publishable on its own. Control Plane passes the workspace back through the ADE runtime:

- deterministic staged validation;
- configured specialist profile reviews;
- bounded correction passes when blocking findings are returned;
- publication gate resolution.

Provider choice must not alter which profiles or rules are selected. Those remain repository/ADE configuration concerns.

## Usage and quotas

Both adapters expose normalized usage fields when the provider emits machine-readable metrics. Quota support may differ by provider; lack of a live quota source must remain explicit rather than being represented as zero usage.

Provider identity is persisted with the execution so operational views can distinguish Codex and Claude Code without changing the underlying ADE workflow state.

## Related documentation

- `../AGENTS.md` — canonical Control Plane agent instructions
- `ADE_RUNTIME.md` — ADE runtime and review contract
- `GITHUB_WORK_CONTRACT.md` — durable issue-to-PR lifecycle
- `PROJECT_ONBOARDING.md` — preparing imported repositories for ADE
