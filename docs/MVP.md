# MVP V0

## Goal

Put ADE Control Plane in production quickly by proving one complete, useful coding loop.

V0 is complete when this works reliably:

```text
User opens Dashboard
→ selects a registered project
→ enters a task
→ presses Run
→ execution is persisted
→ one Codex worker starts
→ branch ade/<task-id> is created
→ Codex changes the repository and runs its checks
→ changes are committed and pushed
→ GitHub pull request is opened
→ Dashboard shows final status, logs and PR link
```

The flow must be usable from a phone and run on the Raspberry deployment target.

## Included

- registered projects;
- task prompt entry;
- one active execution globally;
- Codex only;
- PostgreSQL persistence already present in the repository;
- states `PENDING`, `RUNNING`, `SUCCESS`, `FAILED`, `CANCELLED`;
- bounded/sanitized execution logs;
- dedicated Git branch per task;
- commit + push + GitHub PR creation;
- Stop/Cancel for the active task;
- execution history;
- minimal responsive Dashboard;
- polling for status/log refresh;
- Docker Compose deployment on Raspberry/ARM64;
- minimum security required for this exact attack surface.

## Explicitly deferred

The following do not block V0:

- multi-agent and provider routing;
- Claude/Gemini integrations;
- quota/cost manager;
- advanced multi-project scheduler;
- fairness/aging/priority scoring;
- concurrent tasks;
- Git worktrees;
- reviewer agents;
- automatic merge;
- GitHub comments/webhooks as a control interface;
- Redis, Kafka or Kubernetes;
- distributed workers/runners;
- local AI models;
- complex MCP orchestration;
- advanced runner protocol/HMAC/UDS unless a real V0 deployment blocker requires it.

Older docs/issues describing these capabilities are retained as roadmap material only.

## Why PostgreSQL stays

PostgreSQL persistence has already landed. Replacing working persistence with SQLite would consume time without improving the V0 user experience. V0 simplification applies to **new complexity**, not finished infrastructure.

## Execution model

There is exactly one active execution slot.

A second task may be recorded as pending only if the chosen implementation explicitly supports it; otherwise the API should reject the request clearly. V0 does not need a general queue scheduler.

Minimum transitions:

```text
PENDING → RUNNING → SUCCESS
                  ↘ FAILED
                  ↘ CANCELLED
```

No automatic retry is required.

## Git behavior

For each execution:

1. resolve the project through an allow-listed configuration;
2. prepare the local checkout safely;
3. create `ade/<task-id>` from the configured base branch;
4. launch Codex without shell-interpolating the user prompt;
5. capture bounded/sanitized logs;
6. on successful useful changes, commit and push;
7. create a GitHub PR against the configured base branch;
8. persist branch and PR metadata.

V0 never pushes generated changes directly to the base branch and never auto-merges the PR.

## Dashboard V0

A single simple surface is enough:

- project selector;
- task textarea;
- Run button;
- current execution/status;
- Stop button while running;
- recent executions;
- execution logs/detail;
- PR link when available.

Polling is preferred over SSE/WebSockets until production usage proves it insufficient.

## Security baseline

Release-blocking for V0:

- no provider/GitHub credentials committed;
- no secrets/full environment persisted in logs or passed to model context;
- Dashboard protected before external exposure;
- worker and PostgreSQL private;
- no Docker socket mounted;
- repository execution is allow-list based;
- prompts are not interpolated into shell command strings;
- stdout/stderr are bounded and sanitized;
- cancellation only targets the active execution process;
- generated PRs require human review/merge.

Controls that protect capabilities not present in V0 are roadmap items, not blockers.

## Delivery issues

1. #23 — task/execution API with a single active job;
2. #24 — Codex execution and GitHub PR creation;
3. #25 — minimal mobile-friendly Dashboard;
4. #26 — Raspberry Docker Compose deployment.

## Acceptance criteria

- [ ] A registered project can be selected from the Dashboard.
- [ ] A task prompt can be submitted.
- [ ] Only one execution is active at a time.
- [ ] The execution reaches an explicit final status.
- [ ] Codex runs against the allow-listed repository.
- [ ] A dedicated `ade/<task-id>` branch is used.
- [ ] Useful generated changes are committed and pushed.
- [ ] A GitHub PR is created automatically after successful execution.
- [ ] The Dashboard shows sanitized logs and the PR link.
- [ ] Stop/Cancel terminates the active Codex execution cleanly.
- [ ] Restarting services does not erase execution history.
- [ ] `docker compose up -d` works on the Raspberry target.
- [ ] The Dashboard is usable from a phone.
- [ ] The full Dashboard → Codex → PR path has been exercised against a real test repository.

## Scope gate

Before first production, a proposed feature must be necessary for **Dashboard → Codex → PR**. Otherwise defer it until after V0 is running in real use.
