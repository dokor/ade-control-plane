# Production-like GitHub release gate

`deploy/bin/qualify-github-work` is the black-box qualification command for
issue #153. Run it from the deployed checkout on the Raspberry after
`deploy/bin/qualify-h24 --require-backup` has passed.

It uses the real Dashboard URL, the real GitHub repository and the same worker
runtime already deployed. The command authenticates one operator, admits one
open issue through `/api/tasks`, polls the sanitized GitHub-work detail API,
checks the durable workflow stage, then verifies the correlated GitHub branch
and pull request. It stops at `waiting-human` by default. Set
`ADE_RELEASE_GATE_WAIT_FOR_MERGE=true` to continue until the operator has
merged the PR and the Dashboard reports `completed`.

## Run

Use a fresh, harmless open issue in a dedicated ADE-ready test repository. The
operator password must come from the protected runtime environment and is
never included in the generated report:

```bash
export ADE_RELEASE_GATE_DASHBOARD_URL=https://ade.example.test
export ADE_RELEASE_GATE_PROJECT_ID=<registered-project-uuid>
export ADE_RELEASE_GATE_ISSUE_NUMBER=<open-test-issue-number>
export ADE_RELEASE_GATE_REPOSITORY=owner/repository
export ADE_RELEASE_GATE_OPERATOR_PASSWORD=<protected-runtime-value>
export ADE_RELEASE_GATE_WAIT_FOR_MERGE=true
/srv/apps/ade-control-plane/deploy/bin/qualify-github-work
```

Optional controls are `ADE_RELEASE_GATE_TIMEOUT_SECONDS` (default `3600`),
`ADE_RELEASE_GATE_POLL_SECONDS` (default `10`) and
`ADE_RELEASE_GATE_REPORT` (default: a mode `0600` file under `/tmp`). A local
HTTP endpoint is refused unless `ADE_RELEASE_GATE_ALLOW_HTTP=true` is set
explicitly for a controlled non-production test.

The command refuses to start when an `ade/issue-<number>` PR already exists,
unless `ADE_RELEASE_GATE_ALLOW_EXISTING_PR=true` is explicitly selected for a
recovery run. It never merges, closes or edits the issue/PR, and it does not
copy issue bodies, prompts, source, logs or credentials into evidence.

## Evidence and scenario ledger

The generated report records only the deployment URL, repository/issue
identifiers, final durable stage, PR correlation and outcome. Attach it to the
release qualification record with the sanitized output of `qualify-h24`, the
deployed SHA and the operator’s manual observations.

The command provides the real-runtime proof for the raw-issue admission,
ADE-driven lifecycle, durable stage visibility, branch/PR correlation and the
explicit human-merge boundary. Cancellation, timeout, crash/restart,
duplicate-delivery, quota and restore/soak scenarios remain release-blocking
operations to exercise from the checklist; they must not be simulated or
marked complete from this happy-path run alone.
