# V0 Codex Worker

The V0 worker implements issue #24: it claims one pending task, runs Codex in an allow-listed local checkout, pushes a dedicated branch and creates a GitHub pull request. It does not expose a network or generic shell API.

## Project allow-list

`V0_PROJECT_ROOT` is the only permitted checkout root. A registered project must include relative V0 configuration:

```json
{
  "v0": {
    "checkout": "ade-control-plane",
    "baseBranch": "main"
  }
}
```

The worker resolves both the root and checkout canonically, rejects traversal/symlink escapes, and verifies that `origin` is exactly the registered `github.com/<owner>/<repository>` remote. The checkout must be clean before a task starts.

## Execution

Start the worker with `pnpm --filter @ade-control-plane/worker start:v0`. It performs the following typed process calls without a shell:

1. fetch the configured base branch;
2. create/reset `ade/<task-id>` from `origin/<base>`;
3. run `codex exec --sandbox workspace-write --ephemeral --json -` with the task prompt on stdin;
4. stage and commit useful changes with repository hooks disabled;
5. push the dedicated branch;
6. create a pull request through the narrow GitHub App API and tag `@dokor`;
7. persist branch, PR and terminal status.

Codex receives only an allow-listed child environment and its dedicated credential. Database and GitHub App secrets are not inherited. Git uses a separate environment and host credential mechanism such as a dedicated SSH key or credential helper.

## ADE delivery guardrails

The production worker includes the pinned `@alelouet/ai-delivery-engine` CLI.
Before Codex starts, it validates the project's `ade.config` and creates the
configured context pack using `V0_ADE_PROFILE` (`chill`, `normal`, or
`expert`; default `normal`). ADE output directories must be ignored by Git: a
generated, unignored artifact stops the task before Codex can change source.

After Codex changes are staged, `ade review --staged --json` must pass before
the worker can commit, push, or create a PR. The resulting PR records the
context profile and the successful deterministic review; human review and
merge stay explicit.

The worker starts Codex App Server with the same saved Codex login on its own
loopback interface only. Its normalized rate-limit observation is a
fail-closed scheduling gate: unavailable or stale quota starts no task. There
is no App Server Compose service, published port, Docker network listener, or
Traefik route.

## Cancellation and recovery

While Codex runs, the worker polls durable cancellation intent. Cancel or timeout sends `SIGTERM` to the execution process group and escalates to `SIGKILL` after five seconds. No push or PR is attempted after cancellation is observed.

After restart, an existing `RUNNING` task is marked `FAILED` (or `CANCELLED` when cancellation was already requested). The worker never retries it implicitly because a branch, push or PR may already exist and require reconciliation.

## Required runtime configuration

- `DATABASE_URL` or `DATABASE_URL_FILE`;
- `V0_PROJECT_ROOT`;
- `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY_FILE`;
- `CODEX_API_KEY_FILE` or persisted CLI authentication under `CODEX_HOME`;
- `V0_GIT_HOME`, separate from the Codex home and containing only Git push configuration;
- Git push credentials scoped to the allowed repositories.

The GitHub App needs repository pull-request write permission. Git push credentials remain separate from the App private key. Docker/ARM64 packaging and healthchecks belong to issue #26.
