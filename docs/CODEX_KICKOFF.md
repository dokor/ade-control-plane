# Codex Kickoff

## Tomorrow: start with issue #2

Open the repository in Codex from a clean branch based on `main`.

Codex should automatically read `AGENTS.md`. Still anchor the session on one issue rather than asking it to "build the control plane" broadly.

## Recommended first prompt

```text
Work on GitHub issue #2 in this repository.

Before coding:
- read AGENTS.md;
- read docs/DATA_MODEL.md;
- read docs/STATE_MACHINES.md;
- read docs/TESTING_STRATEGY.md;
- read docs/IMPLEMENTATION_PLAN.md;
- inspect the existing monorepo structure and current CI.

Implement only the PostgreSQL persistence foundation described by #2: project registry, executions, atomic execution leases, audit events and control-command idempotency, with versioned migrations and tests.

Important constraints:
- do not implement Dashboard, GitHub integration or host runner yet;
- do not model/copy ADE's delivery graph;
- persist intent/lease before privileged dispatch semantics;
- stale lease does not mean safe retry;
- ambiguous execution outcome remains unknown/reconcile-first;
- secrets/raw tokens must not be persisted or logged;
- use real PostgreSQL integration tests for concurrency/lease behavior;
- keep database interfaces separate from SQL details;
- keep dependencies minimal.

Before finishing:
- run pnpm typecheck;
- run pnpm test;
- review the diff against issue #2 acceptance criteria;
- summarize migration/schema decisions and recovery/idempotency behavior.
```

## Suggested working mode

Let Codex perform the implementation, tests and local refactors on one issue branch.

Review at meaningful checkpoints rather than micromanaging every file:

1. proposed database/library/migration approach;
2. first schema/migrations;
3. lease transaction/concurrency tests;
4. final diff/CI.

## Decisions Codex may make inside #2

It may choose implementation details such as the PostgreSQL client/query/migration library, provided:

- TypeScript typing remains strong;
- transaction/locking semantics are explicit;
- migrations are versioned;
- dependency footprint stays reasonable;
- ARM64 PostgreSQL deployment remains standard;
- repository/domain interfaces do not leak raw SQL throughout the application.

Ask Codex to explain the trade-off before adding a large ORM/framework.

## Do not combine these tomorrow unless #2 is complete

Avoid mixing #2 with:

- #3 real ADE adapter;
- #4 Codex quota integration;
- #11 secure runner;
- #7 Dashboard;
- #8 GitHub App.

Small prerequisite refactors are fine; feature creep is not.

## After #2

Recommended sequence:

```text
#2 persistence
  ↓
#3 ADE adapter
  ├──────────────┐
  ↓              ↓
#4 quota       #11 runner
  └──────┬───────┘
         ↓
       #5 scheduler
         ↓
       #6 H24 worker
       ├──────┐
       ↓      ↓
      #7     #8
 Dashboard  GitHub
       └──┬───┘
          ↓
   #10 security gates
          ↓
       #9 deploy
```

Security work is continuous even though #10 is shown near release closure.

## Prompt for #3 later

```text
Work on issue #3 only. Read AGENTS.md and the ADE boundary docs first. Stabilize the transport-independent ade-client types, fake adapter, normalized errors/retry classification and the boundary that #11 will invoke. Do not inspect project repositories to reconstruct ADE state and do not implement runner privileges in ade-client.
```

## Prompt for #11 later

```text
Work on issue #11. Read AGENTS.md, docs/RUNNER_PROTOCOL.md, docs/SECURITY.md and docs/TESTING_STRATEGY.md. Implement the smallest secure host runner that supports only typed ADE capabilities. Authentication, replay protection, project/capability allow-lists, workspace containment and reconciliation tests are part of the feature, not follow-up hardening. Do not add a generic shell.execute endpoint.
```

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
