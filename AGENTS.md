# AGENTS.md

These instructions apply to every automated coding agent working in **ADE Control Plane**.

## Current mission: ship V0

Do not optimize for the final orchestration platform yet.

The only product loop that matters before first production is:

```text
Dashboard
→ choose project
→ submit task
→ one Codex execution
→ branch ade/<task-id>
→ commit + push
→ GitHub PR
→ status/logs/PR link in Dashboard
```

Issue **#1** is the V0 scope source of truth.

## Mandatory implementation order

Unless the user explicitly changes scope, work in this order:

1. **#23** — task/execution API with exactly one active job;
2. **#24** — local Codex execution + Git branch/push/PR;
3. **#25** — minimal mobile-friendly Dashboard;
4. **#26** — Raspberry Docker Compose deployment.

Do not treat older issues #3–#11 as V0 dependencies. They are post-V0 roadmap unless #1 explicitly promotes a requirement.

## Scope discipline

Before adding an abstraction, package, service, queue, provider adapter or protocol, ask:

> Is this required for Dashboard → Codex → PR?

If no, do not implement it in V0.

Explicitly avoid before first production unless a concrete blocker is demonstrated:

- multi-agent/provider support;
- Claude/Gemini integration;
- quota/cost routing;
- advanced scheduler/fairness/aging;
- concurrent tasks;
- worktrees;
- reviewer agents;
- auto-merge;
- GitHub command/webhook control surface;
- Redis/Kafka/Kubernetes;
- distributed runners;
- generic MCP architecture;
- local models;
- advanced UDS/HMAC runner protocol.

## Keep what already works

PostgreSQL persistence is already implemented. **Do not replace it with SQLite.** Simplifying V0 means reducing new work, not rewriting finished infrastructure.

Existing packages can remain even when they are outside the critical path. Do not spend V0 time deleting roadmap code unless it actively blocks the V0 flow.

## Architecture boundary

ADE remains the owner of project-specific delivery semantics where ADE is involved. ADE Control Plane must not reconstruct ADE delivery graphs or duplicate project-specific planning.

For V0, the control plane only needs to:

- know registered/allow-listed repositories;
- persist tasks/executions/logs;
- run one Codex process safely;
- manage the task Git branch;
- create a GitHub PR;
- expose status/control through the Dashboard.

## Security baseline

Security remains mandatory, but implement controls proportionate to V0 capabilities.

Non-negotiable V0 invariants:

- no credentials committed to the repository;
- no secrets/full environment dumped into prompts, DB logs or UI;
- no `/var/run/docker.sock` in Dashboard/worker containers;
- PostgreSQL and worker are not publicly exposed;
- Dashboard is protected before public/reverse-proxy exposure;
- only explicitly registered/allow-listed repositories may be executed;
- user prompts are passed as process arguments/stdin/API input, never interpolated into a shell command;
- stdout/stderr are bounded and sanitized;
- cancellation targets only the active execution process;
- no auto-merge of generated PRs;
- failures must not be represented as success.

If a change expands privileges or attack surface, consult `docs/SECURITY.md` and add the smallest necessary protection/tests.

## Development workflow

Work issue-first.

Before implementing:

1. read issue #1;
2. read the target V0 issue;
3. inspect current code before creating a new abstraction;
4. identify the minimum coherent change that advances the end-to-end flow.

During implementation:

- prefer straightforward TypeScript over framework-heavy abstractions;
- reuse existing persistence/contracts when practical;
- keep I/O boundaries explicit;
- use explicit execution states;
- preserve useful errors and sanitized logs;
- write tests around state transitions, single-active-job enforcement, process failure and cancellation;
- do not implement future flexibility without a current use case.

Before considering work complete:

- `pnpm typecheck` passes;
- relevant tests pass;
- the issue acceptance criteria are satisfied;
- no secret or unsafe shell interpolation was introduced;
- user-visible behavior is documented if it changed;
- the PR explains what remains intentionally out of scope.

## V0 Definition of Done

V0 is done when a user can open the Dashboard on a phone, choose a registered project, describe a task, press Run, and later open the GitHub PR created by Codex, with execution status and logs available in the Dashboard.

Ship that before building the control plane we might need later.
