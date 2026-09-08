# V0 Agent Worker

> Historical filename: `V0_CODEX_WORKER.md`. The implementation now supports multiple coding providers through the shared `AgentExecutor` contract.

The worker claims durable work, runs the configured coding provider in an allow-listed workspace, passes the result through ADE validation/review, pushes a dedicated branch and creates a GitHub pull request. It does not expose a network or generic shell API.

## Provider selection

`V0_AGENT_PROVIDER` selects the implementation adapter:

```text
codex
claude-code
```

The provider choice does not select a different ADE workflow. Both adapters receive the same validated ADE handoff and run inside the same checkout, validation, specialist-review, publication and reconciliation lifecycle.

There is no automatic provider fallback. If the selected provider fails, the execution fails explicitly.

See [`AGENT_EXECUTORS.md`](AGENT_EXECUTORS.md) for the adapter contract.

## Project allow-list

`V0_PROJECT_ROOT` is the only permitted checkout root. A registered project includes relative V0 configuration such as:

```json
{
  "v0": {
    "checkout": "ade-control-plane",
    "baseBranch": "main"
  }
}
```

The worker resolves both the root and checkout canonically, rejects traversal/symlink escapes, and verifies that `origin` is exactly the registered `github.com/<owner>/<repository>` remote. Executions use isolated workspaces where configured and validate the checkout baseline before starting.

## Repository agent instructions

ADE-enabled projects should expose a root `AGENTS.md` as their canonical provider-neutral instruction contract.

A provider-specific file such as `CLAUDE.md` may adapt discovery for that provider, but should defer to `AGENTS.md` instead of redefining the workflow.

The worker's structured ADE handoff remains more authoritative than free-form repository issue prose.

## GitHub issue execution

For an ordinary GitHub issue, the unified worker follows this flow:

1. prepare the registered checkout/workspace;
2. fetch and prepare the execution branch;
3. ask ADE to resolve the issue lifecycle;
4. if ADE returns `enrich`, execute the provider with ADE's bounded enrichment instruction and update/replan the issue;
5. require a validated `ade.implementation-handoff/v1` before development;
6. prepare ADE context for the selected implementation profile;
7. execute the selected coding provider with the validated handoff;
8. require useful repository changes;
9. run ADE deterministic validation and configured specialist reviews;
10. apply only ADE-bounded correction passes when required;
11. require ADE's publication gate;
12. commit and push the reviewed branch;
13. create/reconcile the GitHub PR;
14. persist the workflow in a human-waiting state until review/merge reconciliation completes.

The coding provider does not own steps 11–14. The worker owns publication and GitHub lifecycle mutations.

## Provider invocation

### Codex

The Codex adapter currently invokes:

```bash
codex exec --sandbox workspace-write --ephemeral --json -
```

The prompt is provided through stdin.

### Claude Code

The Claude Code adapter currently invokes:

```bash
claude --print --output-format json
```

The prompt is also provided through stdin.

Both adapters normalize machine-readable usage metrics when the provider emits them.

## ADE delivery guardrails

The production worker includes a pinned `@alelouet/ai-delivery-engine` CLI.

Before implementation, ADE validates repository configuration/readiness, resolves the issue lifecycle and prepares the configured context/profile. Project-specific rules, skills and specialist profiles come from ADE, not from Control Plane heuristics.

After the provider modifies the workspace, the worker calls the shared `AdeDeliveryRuntime` to run:

- deterministic staged validation;
- configured specialist profile reviews;
- bounded correction passes where allowed;
- final publication-gate resolution.

No provider is allowed to bypass a failed ADE gate merely because it produced code successfully.

The generated PR records safe ADE provenance. Raw provider reasoning/chain-of-thought is not persisted.

## Publication ownership

For orchestrated executions, the provider prompt explicitly states that the worker owns:

- commit;
- push;
- issue metadata;
- pull-request creation;
- lifecycle reconciliation.

This prevents Claude Code or Codex from independently mutating GitHub and creating duplicate or untracked publication state.

Human merge remains explicit. The worker never auto-merges generated PRs.

## Cancellation and recovery

While a provider runs, the worker observes durable cancellation intent. Cancellation/timeout terminates the owned execution process and prevents later publication from being treated as successful.

Durable ADE workflow checkpoints allow restart reconciliation around publication and human-decision boundaries. The worker must reconcile existing branches/PRs instead of blindly replaying side effects.

## Quota behavior

Quota observation is provider-specific, but scheduling semantics remain explicit:

- Codex may use the private Codex App Server quota source when configured;
- Claude Code currently has no equivalent live quota source in this worker path;
- unknown quota is never represented as zero usage;
- a provider's quota observations must never be applied to another provider's execution.

Provider identity is persisted with usage/execution state.

## Required runtime configuration

Common configuration includes:

- `DATABASE_URL` or `DATABASE_URL_FILE`;
- `V0_PROJECT_ROOT`;
- `V0_AGENT_PROVIDER`;
- `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY_FILE`;
- `V0_GIT_HOME`, separated from provider-specific credentials;
- Git push credentials scoped to allowed repositories;
- pinned ADE executable/runtime configuration.

Provider-specific configuration then supplies either Codex or Claude Code executable/authentication/environment values.

The GitHub App needs the repository permissions required by the documented GitHub lifecycle. Git push credentials remain separate from the App private key.

## Related implementation docs

- [`AGENT_EXECUTORS.md`](AGENT_EXECUTORS.md)
- [`ADE_RUNTIME.md`](ADE_RUNTIME.md)
- [`GITHUB_WORK_CONTRACT.md`](GITHUB_WORK_CONTRACT.md)
- [`PROJECT_ONBOARDING.md`](PROJECT_ONBOARDING.md)
- [`OPERATIONS.md`](OPERATIONS.md)
