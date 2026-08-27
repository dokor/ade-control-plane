# Codex Kickoff

## Current priority: production V0

The immediate target is **Dashboard → one Codex task → branch → PR → logs**.

Do not start from the old advanced-roadmap order. Use the current issue sequence below.

## 1. Start with #23

Suggested prompt:

```text
Work on issue #23 in dokor/ade-control-plane.

Before changing code, read AGENTS.md, docs/IMPLEMENTATION_PLAN.md, docs/DATA_MODEL.md, docs/SECURITY.md and the issue body.

Goal: implement the minimal V0 task/execution path using the existing PostgreSQL project registry and persistence. We need project + prompt submission, exactly one active execution, PENDING/RUNNING/SUCCESS/FAILED/CANCELLED semantics, bounded sanitized logs, history/detail and cancel intent.

Keep the change focused on #23. Do not implement Codex execution, the task Dashboard, Docker deployment, quota routing, advanced fairness or remote runners in this issue.

Preserve the existing advanced execution/recovery model where useful instead of replacing it unnecessarily. Add migrations/contracts only where V0 task semantics need them.

Run pnpm typecheck and pnpm test. Add tests for single-active-execution concurrency/idempotence and unsafe log/prompt handling.

When complete, open a PR that closes #23 and clearly documents persistence, failure/recovery and security behavior.
```

## 2. Then #24 — real Codex → PR

```text
Work on issue #24 after #23 is merged.

Read AGENTS.md, docs/IMPLEMENTATION_PLAN.md, docs/SECURITY.md and issue #24.

Implement the smallest real Codex execution path for one registered/allowed project: prepare checkout, create ade/<task-id>, launch Codex without shell interpolation, capture bounded sanitized logs, support timeout/cancel, commit, push and create a GitHub PR. Persist terminal status and PR reference through the #23 execution model.

Do not add multi-agent routing, fairness, quota scheduling, auto-merge or distributed runners.
```

## 3. #25 can run in parallel after #23

```text
Work on issue #25 after #23 is merged. You may use a fake execution adapter while #24 is in progress.

Build the task-oriented mobile Dashboard flow: select project, enter prompt, Run, current status, Stop, recent history, execution logs/detail and PR link. Keep polling simple. Reuse the existing authentication/session/security infrastructure.

Do not make advanced quota/runner/scheduler controls a prerequisite for submitting a V0 task.
```

## 4. Finish the V0 with #26

```text
Work on issue #26 only after #23, #24 and #25 are merged.

Package the V0 for Raspberry/ARM64 with Dashboard, worker and PostgreSQL, persistent data, runtime secrets, healthchecks/restart policy, no public DB/worker port and no Docker socket. Document install/update/restart/backup.

The final acceptance test is real: from the deployed Dashboard, submit a task and obtain a GitHub PR with visible logs/status.
```

## 5. Close #1 after the real end-to-end proof

#1 is the V0 umbrella. It closes only when the deployed Dashboard/mobile flow produces a real GitHub PR and survives restart with its history intact.

## Already completed foundations

Do not reopen or reimplement these unless a concrete V0 bug requires it:

- #2 PostgreSQL durable state;
- #3 ADE adapter;
- #5 deterministic scheduler;
- #6 crash-safe worker/recovery;
- #7 global supervision Dashboard/control API;
- #11 secure typed runner foundation.

## Post-V0

Remaining advanced roadmap issues are not blockers for #23–#26:

- #4 real Codex quota ingestion;
- #8 GitHub project commands/notifications;
- #10 full release-hardening/security closure;
- #9 advanced Raspberry topology/deployment after #10.

Security is still continuous: minimum safe auth, secret handling, sanitization, process isolation and network exposure rules remain mandatory in the V0.

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
