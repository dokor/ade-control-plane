# Supported ADE runtime

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
