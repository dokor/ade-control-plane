# Codex Kickoff

## Current priority: deploy the production V0

The immediate target remains **Dashboard → one Codex task → branch → PR → logs**, but #23, #24 and #25 are already merged.

The next implementation issue is therefore **#26**.

## 1. Work on #26 — first Raspberry deployment

Suggested prompt:

```text
Work on issue #26 in dokor/ade-control-plane.

Before changing code, read:
- AGENTS.md
- docs/PRODUCT_TARGET.md
- docs/FIRST_DEPLOYMENT.md
- docs/SECRET_MATRIX.md
- docs/RELEASE_CHECKLIST.md
- docs/OPERATIONS.md
- docs/SECURITY.md
- issue #26 and its latest comments

#23, #24 and #25 are already merged. Do not rebuild the task API, V0 Codex worker or task Dashboard unless #26 reveals a concrete deployment bug.

Goal: package the existing V0 for the real Raspberry Pi 5 / ARM64 target with Dashboard/control API, worker and PostgreSQL, persistent SSD-backed data, runtime secret injection, healthchecks/restart policy, private DB/worker networking, no Docker socket and the existing reverse-proxy/TLS model.

The final acceptance is not only `docker compose up -d`. Follow docs/FIRST_DEPLOYMENT.md and prove a real deployed Dashboard task reaches Codex, modifies only the allow-listed repository, creates ade/<task-id>, pushes a commit and opens a real GitHub PR. Then verify restart/reboot preserves history.

Keep deployment changes focused. Do not add Kubernetes, Redis, distributed runners, multi-provider routing or automatic production deployment of generated projects.

Run pnpm typecheck/tests plus Compose/build validation. Document any Raspberry-only manual validation that cannot run in GitHub-hosted CI.

When complete, open a PR that closes #26 only if the real Raspberry acceptance evidence is available; otherwise merge the deployable code and leave #26 open with the remaining runtime proof clearly documented.
```

## 2. After the manual deployment — #36 automatic Control Plane deployment

```text
Work on issue #36 only after the #26 deployment path has been proven manually.

Read docs/CD_DEPLOYMENT.md, docs/SECRET_MATRIX.md, docs/RELEASE_CHECKLIST.md and issue #36.

Implement GitHub Actions CD from a trusted successful main SHA to the Raspberry using the documented github-runner identity and a narrow allow-listed host deploy wrapper. Do not grant generic sudo/root/Docker authority to the Actions runner. Serialize deployments, run controlled migrations/update, verify healthchecks, record the deployed SHA and keep a documented manual fallback/rollback path.
```

## 3. Then connect real Codex quota — #4

```text
Work on issue #4 after the first deployment is stable enough to exercise real quota reads.

Read docs/QUOTA_HISTORY.md and issue #4.

Connect the real supported Codex/App Server quota source behind the existing provider adapter. Persist one normalized successful snapshot per useful observation, keep a rolling 30-day history, never invent missing percentages, preserve freshness/stale semantics and expose only normalized safe data to scheduling/Dashboard.
```

## 4. Then define the GitHub-first work adapter — #40

```text
Work on issue #40 before #37.

Read docs/GITHUB_WORK_CONTRACT.md, docs/GITHUB_INTEGRATION.md and issue #40.

Define and implement a versioned, strict GitHub App adapter that detects a
compatible repository without an ADE CLI, normalizes explicit issue metadata
into GitHubWorkItem snapshots and shares the same normalizer for webhook and
periodic reconciliation. Do not infer dependencies from prose/labels and do
not add an MCP endpoint.
```

## 5. Then multi-project orchestration — #37

```text
Work on issue #37 after #26 is proven and preferably after real quota observation is available.

Read docs/PRODUCT_TARGET.md, docs/PROJECT_ONBOARDING.md, docs/MULTI_PROJECT_ACCEPTANCE.md, docs/SCHEDULER.md, docs/GITHUB_INTEGRATION.md and issue #37.

Goal: move from the single-task production V0 to the intended always-on ADE orchestrator across X existing/new ADE-compatible projects. ADE remains source of truth for project-local ordering/runnable state. The Control Plane builds only a derived global queue/read model, chooses among ADE-reported runnable work and continues other projects while one waits for human input.

Do not reconstruct ADE's delivery graph from GitHub issue text or labels.
```

## 6. Finish GitHub proactive attention flow — #8

The inbound GitHub command path is already largely implemented. The remaining important behavior is proactive project-scoped notification when ADE/worker reports meaningful human attention, such as waiting-human or intervention-required failure.

Use `docs/GITHUB_APP_SETUP.md` and `docs/GITHUB_INTEGRATION.md` as the contract.

## 7. Advanced H24 qualification

After the useful multi-project product loop works:

- #11 — complete the real secure host runner service/executor integration;
- #10 — demonstrate remaining security/release gates with runtime evidence;
- #9 — qualify the advanced always-on Raspberry topology/operations.

## Already completed foundations

Do not reopen or reimplement these unless a concrete bug requires it:

- #2 PostgreSQL durable state;
- #3 typed ADE adapter foundation;
- #5 deterministic scheduler foundation;
- #6 crash-safe worker/recovery foundation;
- #7 global supervision Dashboard/control API;
- #23 V0 task/execution API;
- #24 V0 real Codex → branch/commit/push/PR code path;
- #25 task-oriented Dashboard.

The secure runner protocol foundation also exists, but #11 remains open because the complete host runtime/executor integration is not yet qualified.

## Product target reminder

The single-task V0 is a deployment milestone, not the final product.

The target remains:

```text
X ADE-compatible projects
→ ADE reports project-local runnable work / human gates
→ Control Plane builds global queue
→ scheduler chooses next eligible project/work item
→ ADE executes
→ GitHub issues/PRs/decisions carry project interaction
→ Dashboard supervises progress, queues, human attention, quota history and runner health
```

A `waiting-human` project must not freeze unrelated runnable projects.

## Review questions after each Codex PR

Ask:

- Does this preserve the ADE/control-plane ownership boundary?
- What happens if the process/network dies at the worst moment?
- Can this operation be replayed or applied twice?
- Which credentials can this component access?
- Is external input treated as untrusted?
- Is every privileged mutation auditable?
- Are retries safe or should they reconcile first?
- Did the change introduce a new public/privileged capability that needs threat-model documentation?
- Does this move us toward the multi-project product target rather than only polishing the V0?
