# ADE Control Plane

ADE Control Plane is the orchestration and supervision layer around **AI Delivery Engine (ADE)**. Import GitHub projects, prepare their ADE setup, run ordinary issues, and follow durable workflows, blockers, pull requests and AI usage from a mobile-friendly Dashboard.

The Control Plane is provider-neutral at the delivery level: ADE owns the workflow and produces the same validated implementation handoff whether the configured coding provider is **Codex** or **Claude Code**.

## Product MVP

The functional MVP has three parts:

1. **Use ADE on imported projects.** Register a repository without assuming a worker checkout exists, provision it, propose missing setup through a reviewable PR, and prove readiness with real runner-side ADE checks.
2. **Deliver an ordinary issue end to end through ADE.** One initial Run starts the normal lifecycle; operators do not manually start a new Codex/Claude conversation between stages.
3. **Provide an operational Dashboard.** Show setup/readiness, task stages, actionable blockers and decisions, issue/branch/PR correlation, usage/quota/dispatch state, cancellation and safe terminal test-work cleanup.

```text
ordinary GitHub issue
→ refinement/enrichment when needed
→ ADE workflow/profile/skill/rule resolution
→ validated ADE implementation handoff
→ Codex OR Claude Code
→ deterministic validations
→ ADE specialist reviews + bounded corrections
→ branch / push / PR
→ human review or decision
→ resume the same workflow when required
→ human merge
→ completed
```

Human decisions can occur before publication; merge is always an explicit human action.

## Provider-neutral ADE contract

ADE is the source of truth for delivery semantics. A project prepared for ADE should expose a root `AGENTS.md` containing the provider-neutral instructions that every coding agent must follow.

Provider-specific files are adapters only. For example, a `CLAUDE.md` may tell Claude Code to read `AGENTS.md`, but it must not maintain a second, divergent delivery workflow.

For an execution, the order of authority is:

1. the structured ADE execution / implementation handoff;
2. the repository root `AGENTS.md`;
3. ADE-selected repository skills and technical documentation;
4. free-form GitHub issue/comment prose as reference material.

Changing `V0_AGENT_PROVIDER` changes the executable adapter, not the ADE lifecycle, readiness gates, specialist reviews, validations, publication boundary or human merge gate.

See [Agent executors](docs/AGENT_EXECUTORS.md) and [ADE runtime](docs/ADE_RUNTIME.md).

### Qualification status

The main lifecycle implementation is merged and covered by repository tests/CI. That is **not yet proof of the complete imported-project journey on the production Raspberry**.

- [#185](https://github.com/dokor/ade-control-plane/issues/185): verify secure fresh Git provisioning with the deployed image and real worker credentials.
- [#189](https://github.com/dokor/ade-control-plane/issues/189): prove registration/Prepare ADE through the first ADE-managed issue PR and merge.
- [#153](https://github.com/dokor/ade-control-plane/issues/153): collect the evidence and sign off the functional MVP.

The separate [#88 H24/48h+ soak](https://github.com/dokor/ade-control-plane/issues/88), [#9 advanced Raspberry topology](https://github.com/dokor/ade-control-plane/issues/9), [#10 full hardening](https://github.com/dokor/ade-control-plane/issues/10) and [#152 explicit provider/model policy](https://github.com/dokor/ade-control-plane/issues/152) are follow-up qualification/roadmap. The functional MVP does not wait for the soak; mandatory authentication, credential isolation and safe execution still apply.

## What is implemented

- GitHub project import/registration, allow-listed worker checkout provisioning, pinned SSH host trust and classified Git preflight failures.
- Prepare ADE/setup PRs, declared skill-path repair, initialization and runner capability proof; no-diff initialization reinspects readiness instead of failing automatically.
- Ordinary open-issue admission without manual ADE metadata, refinement/enrichment and ADE-owned delivery plans and validated implementation handoffs.
- Repository-defined ADE profiles, skills, rules, deterministic validations, specialist reviews and bounded corrections.
- Provider-neutral agent execution through a shared `AgentExecutor` contract, with Codex and Claude Code adapters when their runtime and credentials are configured.
- A shared provider-neutral repository instruction convention based on root `AGENTS.md`; provider-specific files remain adapters only.
- PostgreSQL-backed delivery workflows/checkpoints, restart-safe publication recovery and same-workflow human-decision resume.
- Cancellation, lease heartbeats, execution deadlines, startup reconciliation and GitHub label/branch/PR/merge lifecycle synchronization.
- Dashboard Overview, project setup/status, durable workflow details/blockers/evidence, safe removal of correlated terminal test work, and AI usage/quota visibility.
- Shared provider quota/dispatch policy, event wakeups, rate-limit-aware reconciliation and H24 operational foundations.

Quota/usage values depend on available provider observations; unknown values are not presented as zero. Test-work removal preserves GitHub issues, branches and PRs.

## Architecture and ownership

```text
Dashboard / control API ↔ PostgreSQL durable state
                                  ↕
                        unified worker / scheduler
                                  ↓
                             ADE runtime
                                  ↓
               validated implementation handoff
                                  ↓
                    AgentExecutor abstraction
                       ↙                 ↘
                    Codex             Claude Code
                       ↘                 ↙
                  isolated execution workspace
                                  ↓
                    ADE validation / reviews
                                  ↓
                  GitHub branch / PR / reconciliation
                                  ↓
                         explicit human merge
```

**ADE owns** project workflows, profiles, skills, rules, gates, review/correction semantics and versioned delivery contracts. Repository configuration determines what the work requires.

**Control Plane owns** registration, scheduling, persistence, orchestration, provider dispatch, quotas, Git/GitHub side effects, PR correlation, reconciliation and observability. It consumes ADE's plans; it does not reconstruct project delivery graphs or choose profiles through local heuristics.

**The coding provider owns only implementation inside the assigned workspace.** It must not redefine ADE policy or perform publication steps that the worker owns.

The current Compose stack runs an authenticated Next.js Dashboard, private PostgreSQL and the unified GitHub-work worker. The worker runs ADE, the selected agent and Git in the configured isolated execution environment. The host-runner/UDS packages remain available foundations; a separate distributed/host-runner topology is not a prerequisite for the current functional flow.

## Getting started

### Prerequisites

- Node.js 22+, pnpm matching the root `packageManager`, Git and PostgreSQL.
- For real execution: the supported ADE CLI described in [ADE runtime](docs/ADE_RUNTIME.md), the selected agent runtime and its dedicated credentials.
- A GitHub App installation with access to the test repository; API credentials and worker Git clone/push credentials are separate.
- An allow-listed repository/checkout root and a low-risk ordinary issue. Do not develop against production secrets or run a second worker against a live queue.

Install and check the workspace:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

PostgreSQL integration tests require `TEST_DATABASE_URL` pointing to a disposable test database; otherwise they are skipped. CI supplies PostgreSQL.

### Configure and start locally

Use [.env.example](.env.example) as the configuration reference, **not as a ready-to-run local environment**: it contains production container paths and placeholders. Supply real values through your shell or protected runtime files; the commands below do not automatically load the root example file.

Configure:

- `DATABASE_URL` or `DATABASE_URL_FILE` for the development database.
- Dashboard URL, signed-session secret and operator password hash (the hash command is documented in the example).
- GitHub App ID, installation ID and private-key file; configure the webhook secret/actor allow-lists if using webhook delivery.
- Absolute `V0_PROJECT_ROOT` and separate worker Git home.
- `V0_AGENT_PROVIDER=codex` or `V0_AGENT_PROVIDER=claude-code`.
- The corresponding provider executable, home/environment and credentials.
- ADE executable/runtime version configuration.
- Valid quota observations when supported and enabled project/scheduler state before expecting dispatch.

The provider-specific environment only controls invocation. Both providers receive the same ADE workflow contract.

See [Dashboard](docs/DASHBOARD.md), [agent executors](docs/AGENT_EXECUTORS.md), [worker configuration](docs/V0_CODEX_WORKER.md), [GitHub integration](docs/GITHUB_INTEGRATION.md) and [secret handling](secrets/README.md) for detailed configuration. The unified worker runs database migrations at startup.

In separate terminals with the appropriate environment:

```bash
pnpm dev:dashboard
pnpm --filter @ade-control-plane/worker dev:github-work
```

Use the explicit `dev:github-work` entrypoint for the product lifecycle; the root `dev:worker` command is not a substitute for this unified worker. The Compose image bundles its ADE runtime and private Codex App Server where configured; local runs must supply their own selected provider runtime.

### First project and issue

1. Sign in to Dashboard and import/register an allowed GitHub repository.
2. Open the project and follow **ADE Setup**: prepare missing state and review/merge any setup PR on GitHub.
3. Ensure the prepared repository has a root `AGENTS.md`. A provider-specific file such as `CLAUDE.md` may defer to it but should not duplicate the ADE workflow.
4. Run ADE initialization to refresh the worker checkout and record real capability/readiness evidence. Resolve reported gaps; a setup PR alone is not readiness.
5. Select an ordinary open issue and press **Run** once.
6. Follow the workflow detail, validations/reviews, blockers and AI usage/quota views. Resolve a human decision on the existing workflow if needed.
7. Review and merge the generated PR explicitly; confirm reconciliation reaches `completed`.

See [project onboarding](docs/PROJECT_ONBOARDING.md) and [release qualification](docs/RELEASE_GATE.md). Production qualification remains pending until the evidence required by #185/#189/#153 is recorded.

### Raspberry deployment without terminal access

Follow the existing **CI → Deploy production** GitHub Actions path after a reviewed merge, then verify the result from Dashboard. The worker image includes its GitHub host-key pin; it does not require a manual `known_hosts` edit on the Raspberry. Existing authorized Git credentials are still required. If the self-hosted deployment runner or credentials are unavailable, an authorized administrator is needed.

For first installation, permissions, network boundaries and recovery, use [deployment](docs/DEPLOYMENT.md) and [operations](docs/OPERATIONS.md), not ad hoc changes inside containers.

## Repository map

| Location | Responsibility |
| --- | --- |
| `AGENTS.md` | Canonical provider-neutral instructions for coding agents working on Control Plane |
| `apps/dashboard` | Next.js UI, authenticated control API and read models |
| `apps/worker` | Unified scheduler/orchestrator, ADE CLI boundary and provider-neutral agent/Git execution |
| `packages/database` | PostgreSQL contracts, migrations, workflows, logs and audit persistence |
| `packages/github` | GitHub App/API integration, lifecycle metadata and synchronization |
| `packages/ade-client` | Versioned ADE adapter/client contracts |
| `packages/core`, `packages/quota` | Scheduling domain, quota and dispatch policy |
| `packages/host-runner`, `packages/runner-protocol`, `runner` | Runner/UDS foundations and host tooling |
| `deploy`, `docs` | Deployment, qualification scripts and operational/design documentation |

## Further reading

- [Documentation index](docs/README.md) and [product target](docs/PRODUCT_TARGET.md)
- [Canonical agent instructions](AGENTS.md) and [agent executors](docs/AGENT_EXECUTORS.md)
- [Security boundaries](docs/SECURITY.md)
- [Dashboard](docs/DASHBOARD.md) and [operations](docs/OPERATIONS.md)
- [ADE runtime](docs/ADE_RUNTIME.md) and [GitHub work contract](docs/GITHUB_WORK_CONTRACT.md)
- [Project onboarding](docs/PROJECT_ONBOARDING.md)
- [Runner protocol](docs/RUNNER_PROTOCOL.md)
- [Release gate](docs/RELEASE_GATE.md) and [scenario evidence](docs/RELEASE_SCENARIOS.md)
