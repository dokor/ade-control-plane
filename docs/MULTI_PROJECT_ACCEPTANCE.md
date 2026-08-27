# Multi-Project Orchestration Acceptance Scenarios

## Purpose

Define black-box product scenarios for issue #37 before implementation. These scenarios verify the intended behavior without asking the Control Plane to understand ADE's internal delivery graph.

## Test fixture

Use at least three ADE-compatible projects:

- Project A — existing repository retrofitted with ADE;
- Project B — new ADE project;
- Project C — existing/new repository with different priority or runner requirements.

Each project exposes safe test work with GitHub issue references when possible.

## Scenario 1 — mixed old/new onboarding

1. Register Project A through existing-repository onboarding.
2. Register Project B through new-project onboarding.
3. Run the same compatibility check for both.
4. Enable both explicitly.

Expected:

- both enter the same scheduler/read-model path;
- Dashboard does not distinguish their scheduling semantics based on age/origin;
- incompatibility is based only on ADE contract/configuration.

## Scenario 2 — global queue derived from ADE

ADE reports:

```text
A → issue #101 runnable
B → issue #202 runnable
C → no runnable work
```

Expected Dashboard queue:

- A/#101 and B/#202 appear as runnable candidates;
- C appears idle/no-runnable-work, not as a fabricated backlog item;
- queue carries ADE work ref + GitHub ref + safe summary;
- Control Plane does not fetch/infer extra dependencies from issue text.

## Scenario 3 — human gate does not freeze global work

Initial state:

```text
A/#101 → waiting-human
B/#202 → runnable
C/#303 → runnable
```

Expected:

- A appears in human-attention/waiting queue;
- B or C is selected according to global scheduler rules;
- no execution slot is consumed by A while it waits;
- system remains active without manual restart.

## Scenario 4 — decision wakes blocked project

1. A is waiting on decision `D42`.
2. Human resolves `D42` from GitHub or supported Dashboard action.
3. Control Plane validates and forwards exact typed decision to ADE.
4. ADE reports A runnable again.

Expected:

- scheduler wake/reconsideration occurs without service restart;
- A re-enters runnable candidates;
- accepted decision is auditable;
- invalid option/ref remains refused.

## Scenario 5 — project-local ordering stays in ADE

ADE reports only A/#103 runnable while GitHub visibly contains #101/#102/#103.

Expected:

- Control Plane schedules only #103 if ADE says it is runnable;
- it does not choose #101 because of lower issue number/label/text;
- no dependency graph is reconstructed in PostgreSQL.

## Scenario 6 — project priority affects global selection

ADE reports A and B runnable. Both pass hard gates.

- A priority 40;
- B priority 80.

Expected: B wins unless an explicitly documented fairness/aging rule changes the result; explanation is visible/auditable.

## Scenario 7 — fairness/aging prevents indefinite starvation

Keep a lower-priority project runnable while higher-priority work repeatedly appears.

Expected: behavior matches the scheduler's documented aging/fairness contract; if starvation is intentionally possible under current policy, Dashboard explanation must make it explicit. Tests must encode the chosen rule rather than relying on timing guesses.

## Scenario 8 — quota global hard block

All projects have runnable work but current Codex quota policy is `blocked`.

Expected:

- no new execution starts;
- current queue remains visible;
- reason is global quota block;
- active execution behavior follows quota policy (finish/drain as specified);
- after reset/refresh returns allowed state, candidates are reconsidered.

## Scenario 9 — stale/unknown quota

Quota read fails and last snapshot is stale.

Expected:

- Dashboard shows stale/unknown honestly;
- no fabricated percentage;
- scheduler follows conservative configured stale policy;
- failed observation does not overwrite last successful historical value.

## Scenario 10 — runner incompatibility isolated to affected work

A requires a capability unavailable on current runner; B is compatible.

Expected:

- A excluded with `waiting-runner`/incompatible reason;
- B continues;
- no global freeze solely because A cannot run.

## Scenario 11 — crash after dispatch ambiguity

1. A is dispatched.
2. Control Plane/worker crashes after external side effect boundary where completion is uncertain.
3. Service restarts.

Expected:

- A becomes unknown/reconciling rather than fresh retry;
- no duplicate privileged execution starts for A;
- unrelated eligible B/C may continue only if recovery/security policy allows it;
- reconciliation result is auditable.

## Scenario 12 — GitHub duplicate command delivery

Deliver same authorized `@ade` command twice via duplicate webhook delivery / redelivery.

Expected: exactly one internal effect, one durable command identity as designed, no duplicate execution/decision.

## Scenario 13 — queue freshness

Stop refreshing ADE for Project C until its snapshot expires.

Expected:

- C is marked stale/excluded according to policy;
- old runnable work is not silently treated as live forever;
- other fresh projects continue.

## Scenario 14 — project pause

Pause B from Dashboard/GitHub.

Expected:

- B leaves runnable queue immediately after command is applied;
- its ADE project state is not rewritten;
- A/C continue;
- resume returns B to normal eligibility after fresh ADE observation.

## Scenario 15 — restart preserves supervision

Restart Raspberry/control-plane services with:

- one completed project history;
- one waiting-human project;
- one runnable project;
- quota history present.

Expected:

- histories remain;
- waiting state remains visible after ADE refresh/reconciliation;
- scheduler resumes safely;
- 30-day quota observations persist.

## Definition of done for #37 product behavior

#37 should not close until scenarios 1–6, 8, 10–13 and 15 are automated or demonstrated with deterministic integration tests, with scenario 7 reflecting the final fairness policy and scenario 4 exercised through at least one real human-decision path.
