# ADE Control Plane

ADE Control Plane is a small always-on control surface for launching AI coding work against registered projects and following the result from a Dashboard.

## V0 mission

Ship one useful loop before adding orchestration features:

```text
Dashboard
→ choose project
→ describe task
→ create execution
→ one Codex worker runs
→ branch ade/<task-id>
→ commit + push
→ GitHub pull request
→ Dashboard shows status + logs + PR link
```

The V0 is successful when this flow runs reliably on the Raspberry and can be started from a phone.

## Scope rule

Before the first production deployment, every feature must answer:

> Is this required for Dashboard → Codex → PR?

If not, it is post-V0.

### Included in V0

- registered projects;
- one active execution at a time;
- Codex as the only coding agent;
- PostgreSQL persistence already present in the repository;
- execution states `PENDING | RUNNING | SUCCESS | FAILED | CANCELLED`;
- bounded/sanitized logs;
- dedicated Git branch per task;
- commit, push and GitHub PR creation;
- minimal mobile-friendly Dashboard;
- Stop/Cancel;
- Docker Compose deployment on Raspberry;
- minimum production security: protected Dashboard, private DB/worker, no Docker socket, secrets outside prompts/logs/repository.

### Explicitly post-V0

- multiple agents/providers;
- Claude/Gemini routing;
- quota/cost routing;
- advanced multi-project scheduling/fairness;
- concurrent tasks;
- Git worktrees;
- reviewer agents;
- auto-merge;
- GitHub commands as a control interface;
- Redis/Kafka/Kubernetes;
- complex MCP integration;
- local models;
- distributed runners;
- advanced UDS/HMAC runner protocol unless production usage demonstrates it is required.

Existing documentation and issues describing these capabilities are retained as roadmap material. They are not dependencies for V0 unless issue #1 says otherwise.

## V0 delivery order

Work issue-first in this order:

1. **#23** — task/execution API with one active job;
2. **#24** — run Codex and produce a branch/PR;
3. **#25** — minimal mobile-friendly Dashboard;
4. **#26** — Raspberry Docker Compose deployment.

Issue **#1** is the source of truth for V0 scope and Definition of Done.

## Existing persistence

PostgreSQL persistence has already been implemented. Keep it. Replacing it with SQLite would add migration work without improving the first user flow.

Useful commands:

- `pnpm --filter @ade-control-plane/database migrate`
- `pnpm --filter @ade-control-plane/database test`
- `pnpm typecheck`
- `pnpm test`

## Architecture boundary

ADE may still own project-specific delivery logic where it is used. ADE Control Plane should not recreate project delivery graphs or project-specific planning.

For V0, the control plane only needs enough project configuration to safely launch Codex in an allow-listed repository and record the resulting execution/PR.

## Security baseline

Keep security simple but real:

- never commit provider/GitHub credentials;
- never put secrets or full environments into model prompts or persisted logs;
- do not mount `/var/run/docker.sock` into the Dashboard or worker;
- keep PostgreSQL and worker private;
- protect the Dashboard before exposing it through the reverse proxy;
- only operate on explicitly registered/allow-listed repositories;
- pass process arguments without shell interpolation of user prompts;
- bound and sanitize stdout/stderr;
- do not auto-merge generated PRs in V0.

The more advanced threat model in `docs/SECURITY.md` remains useful roadmap guidance, but V0 must not be blocked by controls for capabilities that V0 does not expose.

## Repository

```text
apps/
  worker/          executes the single active coding task
  dashboard/       minimal Dashboard + control API (V0 work)
packages/
  database/        PostgreSQL persistence
  core/            reusable domain primitives where still useful
  ade-client/      existing ADE boundary; keep only what V0 actually needs
  quota/           roadmap code; not on the V0 critical path
docs/
  MVP.md            V0 source of truth together with issue #1
```

Do not create abstractions or packages solely because they appear in older architecture documents.

## For coding agents

Read `AGENTS.md` and the target GitHub issue before making changes. The current V0 issue must override legacy implementation ordering in older docs.
