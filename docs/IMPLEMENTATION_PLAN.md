# Implementation Plan

## Goal

Ship a useful production loop quickly while preserving the stronger control-plane foundations that are already implemented.

The immediate V0 is:

```text
Dashboard
→ choose registered project
→ submit one task
→ persist execution
→ launch Codex
→ branch ade/<task-id>
→ implement + test
→ commit + push
→ GitHub PR
→ Dashboard shows status/logs/PR
```

Only one execution is active at a time in V0.

## Phase V0.1 — Task/execution path (#23)

Reuse the existing PostgreSQL project registry and execution persistence, but add the minimal product-facing task semantics needed by the V0:

- project + prompt submission;
- PENDING/RUNNING/SUCCESS/FAILED/CANCELLED mapping;
- exactly one active execution;
- bounded sanitized logs;
- execution history/detail;
- cancel intent;
- atomic state transitions.

Do not add fairness, provider routing, parallel tasks or additional queue infrastructure.

## Phase V0.2 — Real Codex → GitHub PR (#24)

After #23:

- resolve project through an explicit allow-list/configuration;
- prepare/update the local checkout;
- create `ade/<task-id>`;
- launch Codex with typed process arguments, never shell-interpolated prompt text;
- stream bounded sanitized logs;
- support timeout/cancellation;
- commit and push changes;
- create a GitHub PR;
- persist terminal status + PR reference.

A failed/ambiguous action must not silently create duplicate side effects.

## Phase V0.3 — Task-oriented Dashboard (#25)

May start after #23 in parallel with #24 using a fake execution adapter.

The existing authenticated supervision Dashboard remains useful, but V0 needs a dedicated task workflow:

- project selector;
- prompt textarea;
- Run;
- current execution status;
- Stop when relevant;
- recent history;
- execution detail/logs;
- PR link;
- mobile usability;
- simple polling.

Do not make advanced quota/runner/scheduler views a dependency of task submission.

## Phase V0.4 — Raspberry deployment (#26)

After #23, #24 and #25:

- ARM64-compatible Dashboard/worker/PostgreSQL deployment;
- persistent PostgreSQL volume;
- runtime secrets;
- Dashboard authentication behind TLS/reverse proxy;
- no public DB/worker exposure;
- no Docker socket;
- restart policies/healthchecks;
- backup/update/restart procedure;
- reboot validation;
- real end-to-end test: Dashboard → Codex → PR.

Close umbrella #1 only after this real flow is demonstrated.

---

# Advanced roadmap after V0

The repository already contains significant advanced foundations. Keep them, but do not force unfinished advanced integrations into the V0 critical path.

## Completed foundations

- #2 durable PostgreSQL control-plane state;
- #5 deterministic runner-aware scheduler;
- #6 crash-safe worker/recovery;
- #11 secure typed runner/UDS foundation.

The ADE adapter implementation also exists and should remain transport-independent.

## Post-V0 order

1. finish/verify ADE integration edge cases where needed;
2. finish real Codex quota ingestion (#4);
3. finish global supervision Dashboard gaps if any (#7);
4. GitHub project command/notification interface (#8);
5. full security release gates (#10);
6. advanced Raspberry control-plane topology/deployment (#9) if still distinct from #26;
7. remote runners/multi-machine only after real need appears.

## Invariants across both V0 and advanced work

- ADE owns project-delivery semantics.
- Control Plane owns global orchestration and operational state.
- No arbitrary shell command is exposed by public or runner interfaces.
- Secrets stay out of prompts, logs, persisted raw payloads and Git.
- Ambiguous external side effects require reconciliation before retry.
- Prefer PostgreSQL already present over introducing Redis/Kafka/etc.
- Do not add a feature to V0 unless it is required for Dashboard → Codex → PR or for minimum safe deployment.
