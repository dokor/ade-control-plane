# Supported ADE runtime

## Initialization diagnostics and no-change outcomes

`ade-initialize` records bounded, sanitized JSON log events (`ade.setup.inspected`,
`ade.setup.requirement`, `ade.setup.configuration-error`, `ade.setup.missing-required`
and `ade.setup.missing-capability`). These preserve ADE's requirement status,
criticality, explanation and remediation, configuration errors and capability gaps
for the Dashboard logs/API. Raw report markdown and unrelated fields are excluded.
The same diagnostic projection guides the agent toward targeted repairs/migration;
optional and unverifiable checks are not mandatory repairs.

Diagnostics distinguish absent, compatible, incomplete/invalid and outdated setup.
For a non-ready setup, a simple exact/caret/tilde ADE dependency declaration in the
root package.json with a lower version floor than the worker is labeled `outdated`
(an upgrade candidate). The declared range is not an installed-version measurement
or proof of incompatibility. Complex ranges/unavailable manifests are not guessed.
ADE's setup and delivery contracts remain authoritative: a compatible older project
is not forcibly upgraded, and no new minimum repository version is imposed.

After a successful agent run with no Git diff, initialization repeats the read-only
setup inspection. A ready setup must still pass delivery-plan negotiation before
SUCCESS and default-branch readiness are recorded, without commit, push or PR.
Otherwise the task fails with `ADE_SETUP_STILL_INCOMPLETE` and remaining gaps in the
summary and structured logs. Normal development tasks retain `NO_CHANGES`.
Generated changes still follow validation/review and a human-reviewed PR; unmerged
configuration does not mark the default branch ready.

## Runtime pinning

Control Plane production images pin an exact `@alelouet/ai-delivery-engine`
version through the `ADE_VERSION` build argument. The current supported runtime
is `0.11.0`; the image also publishes the value as `ADE_RUNTIME_VERSION`.

The worker records the runtime version in the task execution log, and the
authenticated Dashboard overview displays it for operators. A future upgrade
must first run the ADE compatibility checks and representative task smoke tests,
then change `ADE_VERSION` in a dedicated PR. The image must never install the
floating `latest` tag.

Every mutating delivery path uses the worker's shared `AdeDeliveryRuntime`.
It validates the installed runtime and project configuration, prepares one
targeted context pack, evaluates the repository with ADE's versioned
`ade.project-setup/v1` contract, runs the deterministic staged review, then
selects and executes the applicable specialist profile reviews through the
configured agent provider. A blocking profile finding gets at most the
configured bounded correction attempts; it can never publish a commit, push or
PR by itself.

Only safe provenance is retained per execution: runtime/setup contract,
runtime/config/context status, rule-pack and selected-profile identifiers,
review status and attempt count.
Raw provider output and chain-of-thought are not persisted.

## Repository code-health delivery policy

This repository uses one `normal` implementation pass followed by four
repository-selected specialist reviews. ADE owns the selection in
`ade.config.json`; the Control Plane consumes the resolved delivery contract and
must not infer profiles from issue wording.

| Profile | Required review concern |
| --- | --- |
| `architecture-maintainability` | Check boundaries, coupling, duplication, clarity, testability and whether the change remains the smallest coherent design. |
| `security` | Check trust boundaries, authorization, input handling, secret/log exposure, process execution and whether privileges or attack surface expanded safely. |
| `performance-resource-lifecycle` | Check bounded work, I/O and database behavior, process cancellation, cleanup, listener/timer/connection lifetime and likely hot-path regressions. |
| `final-quality` | Reconcile the implementation, tests, documentation and earlier evidence against the acceptance criteria; identify omissions, regressions and misleading success states. |

ADE 0.11.0 emits a profile invocation for every configured profile. The
invocation contains the profile ID and a bounded read-only review instruction;
the resolved `ade.delivery-plan/v1` provenance also contains all selected
profile IDs and validation rule IDs. This is the durable link between these
repository-owned concerns and execution evidence. Profile output must use the
worker's bounded finding contract; raw reasoning is neither requested nor
stored.

Deterministic validation has three layers: ADE validates the configuration,
the `development/service-size` rule checks maintainability hotspots in this
repository's executor and orchestrator files, and the worker invokes `ade
review --staged --run-tools --json` so the configured `typecheck` and `test`
tools are blocking before a branch is pushed or a PR is created. A service-size
warning is review evidence, not an automatic architectural failure; type or
test failures remain blocking.

`po-pm` is intentionally separate from implementation and review profiles. ADE
may select it only when an issue genuinely lacks the configured minimum
acceptance criteria. A ready issue remains eligible for `develop`; callers must
not remove detail, labels or metadata to force enrichment.

To audit the policy locally, use an eligible representative issue as standard
input to `ade delivery plan --json`. Confirm that the result is `supported`, the
lifecycle action is `develop`, the four reviews each contain an
`ade.profile-invocation/v1`, `validations` includes
`development/service-size`, and provenance names the same profiles/rule and
`ade.config.json` source. Then run `ade review --staged --json` after preparing
the audit change. `ade config validate` checks configuration shape; delivery
plan resolution additionally returns `UNKNOWN_PROFILE` or `UNKNOWN_RULE` for a
missing referenced name, with no generic fallback. Repository tests pin these
references so accidental removal or renaming fails CI.

The supported 0.11.0 contract used by Control Plane is:

- Node.js 22 or newer;
- `ade config validate` before agent work;
- `ade context generate` to establish a fresh project context;
- `ade context pack <chill|normal|expert>` before agent work;
- `ade setup check --json` after context preparation and before agent work;
- `ade issue plan --json` for repository-owned GitHub issue admission;
- `ade review --staged --json` before commit/push/PR;
- published CLI/templates/resources available from the exact npm release.

`ade setup check --json` is ADE's source of truth for local readiness. Its
`unverifiable` GitHub requirements do not block a worker execution because ADE
has no GitHub access; the Dashboard continues to verify and repair those
remote requirements through the GitHub App.

Project onboarding and compatibility refresh remain explicit lifecycle work in
issue #69; a runtime upgrade does not silently make a project compatible.
