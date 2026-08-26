# Testing Strategy

## Goal

The dangerous failures in ADE Control Plane are rarely simple type errors. The test strategy must prove behavior under duplicate events, crashes, stale state, authorization failure and malicious input.

## Test layers

### Unit tests

Use for deterministic domain logic:

- scheduler filtering/order;
- quota policy thresholds;
- state transitions;
- retry classification;
- command validation;
- redaction helpers;
- runner request canonicalization/signature helpers;
- path containment helpers.

Unit tests should be fast and exhaustive around boundary values.

### Database integration tests

Use real PostgreSQL where transaction/locking behavior matters.

Cover:

- migrations;
- project registry CRUD/state transitions;
- atomic lease acquisition;
- concurrent lease contention;
- lease heartbeat/release;
- stale lease queries;
- execution terminal/idempotent updates;
- command idempotency keys;
- GitHub delivery deduplication;
- audit event persistence.

Do not mock transaction semantics that are central to correctness.

### Runner integration tests

Run the runner against controlled fake ADE/process fixtures.

Cover:

- authenticated valid request;
- invalid authentication;
- expired request;
- replayed request;
- unknown capability;
- unauthorized project;
- path traversal;
- symlink escape;
- timeout;
- cancellation;
- bounded output;
- secret redaction;
- ambiguous process/transport outcome and reconciliation.

Tests must never require real production credentials.

### Worker orchestration tests

Use fake provider/ADE/runner adapters plus real persistence where useful.

Scenarios:

- idle cycle;
- quota blocked;
- project paused;
- no compatible runner;
- successful dispatch;
- lease conflict;
- runner unavailable;
- execution becomes unknown;
- worker restart before/after dispatch;
- stale lease reconciliation;
- global pause/safe mode;
- backoff and wake-up scheduling.

### Dashboard/API tests

Cover:

- unauthenticated access rejected where required;
- read vs mutation authorization;
- CSRF/origin policy for cookie-auth mutations;
- command schema validation;
- no direct runner dispatch in request handler;
- sanitized errors;
- stale snapshot visibly marked;
- responsive critical flows can be covered with browser tests later.

### GitHub integration tests

Cover:

- valid webhook signature;
- invalid signature;
- oversized payload rejection;
- duplicate delivery ID;
- unknown repository;
- unauthorized actor;
- authorized read command;
- authorized mutation command;
- decision reference mismatch;
- repeated command idempotency;
- bot comment update vs duplication;
- untrusted issue text never becoming runner shell input.

## Mandatory failure scenarios before H24 release

### 1. Worker dies before dispatch

Expected: persisted intent/lease is recoverable; no external work happened; safe recovery path exists.

### 2. Worker dies after runner accepted request

Expected: execution is `unknown/reconciling` until runner/ADE state proves outcome. No blind duplicate attempt.

### 3. Runner dies during ADE work

Expected: worker sees lost heartbeat/ambiguous execution and reconciles after runner restarts.

### 4. PostgreSQL connection drops

Expected: no privileged new dispatch occurs without durable intent/lease persistence.

### 5. Duplicate GitHub webhook

Expected: exactly one logical control command/effect.

### 6. Replayed runner request

Expected: rejected and audited before process execution.

### 7. Project path traversal

Expected: rejected before filesystem/process access and treated as security-relevant event.

### 8. Symlink escape

Expected: canonical containment check rejects access outside allowed root.

### 9. Quota source unavailable

Expected: explicit stale/unknown policy applies; never silently interpreted as unlimited/normal.

### 10. Restore old database backup

Expected: scheduling remains paused/safe until all non-terminal executions are reconciled against runner/ADE/external state.

## Concurrency tests

At minimum test:

- two workers attempting same logical lease;
- two command deliveries with same idempotency key;
- completion callback/result processed twice;
- project paused while scheduler candidate selection is in flight.

The expected result should be deterministic and transactionally safe.

## Security tests

Release-blocking security tests include:

- secret redaction corpus;
- runner auth/replay;
- GitHub webhook signature/dedup;
- Dashboard authentication/authorization;
- path canonicalization/traversal/symlink escape;
- unknown fields/capabilities rejected;
- container configuration checks for no privileged/no Docker socket/non-root;
- dependency/container/action scanning.

## Redaction testing

Create test fixtures containing token-shaped values such as:

- bearer authorization values;
- GitHub tokens;
- private-key fragments;
- database URLs/passwords;
- provider API keys;
- secret environment variables.

Assert they cannot appear in:

- audit events;
- Dashboard error responses;
- runner result summaries;
- structured logs;
- persisted error summaries.

Redaction is defense-in-depth; the primary design should avoid passing secrets into broad logging paths at all.

## Test data

Use clearly synthetic project/provider identities and secrets.

Never copy real user tokens, repository secrets or production payloads into fixtures.

## CI progression

### Current

- dependency install;
- typecheck;
- unit tests when present.

### Add with persistence

- PostgreSQL service;
- migration/integration tests.

### Add with runner

- runner integration/security suite.

### Add with containers

- Docker image build;
- container configuration/security scan;
- ARM64 build verification where feasible.

### Add before deployment

- dependency vulnerability scanning;
- GitHub Actions permission review/pinning policy;
- end-to-end smoke flow using fake provider/ADE credentials.

## Test naming

Prefer names that describe the invariant:

```text
rejects a replayed signed runner request
never dispatches when quota snapshot is stale under fail-closed policy
reconciles an unknown execution before creating another attempt
prevents two workers from acquiring the same lease
rejects a workspace symlink escaping the project root
```

These names become useful architecture documentation themselves.
