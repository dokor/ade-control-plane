# Durable Data Model

## Purpose

PostgreSQL stores **global control-plane state only**. ADE remains the source of truth for project delivery graphs, project runs, node status, project decisions and delivery artifacts.

The schema must support:

- crash recovery;
- deterministic scheduling;
- execution leases;
- explainable audit history;
- Dashboard reads;
- GitHub control interactions;
- quota and runner state.

## General conventions

- Use UUIDs for durable control-plane identifiers.
- Store timestamps as timezone-aware PostgreSQL timestamps.
- Prefer explicit enums/status strings with database constraints.
- Use append-only audit/event data for privileged transitions where practical.
- Do not persist secrets in domain tables.
- External/provider payloads should be normalized before storage; raw payload retention requires an explicit security reason.
- Every mutable entity should expose `created_at` and `updated_at` where meaningful.

## `projects`

Represents one project supervised by the control plane.

Suggested fields:

```text
id uuid PK
slug text UNIQUE
name text
repository_owner text
repository_name text
repository_id text NULL
state text CHECK enabled|paused|disabled
priority integer
ade_adapter text
runner_policy jsonb
configuration jsonb
created_at timestamptz
updated_at timestamptz
```

`configuration` must contain orchestration metadata only, never the ADE delivery graph.

Examples of valid configuration:

- local project checkout reference;
- ADE adapter/version expectations;
- required runner labels;
- quota policy override;
- scheduling metadata.

## `project_snapshots`

Stores the latest normalized summary returned by ADE plus historical observations when useful.

Suggested fields:

```text
id uuid PK
project_id uuid FK
ade_run_id text NULL
status text
stage text NULL
milestone text NULL
current_work_ref text NULL
current_work_summary text NULL
next_work_ref text NULL
next_work_summary text NULL
waiting_reason text NULL
requires_human boolean
observed_at timestamptz
expires_at timestamptz NULL
```

This table stores **summaries**, not a copy of the ADE graph.

## `runners`

Represents registered execution environments.

Suggested fields:

```text
id uuid PK
name text UNIQUE
kind text
state text CHECK online|offline|draining|disabled
architecture text
capabilities jsonb
labels jsonb
last_heartbeat_at timestamptz NULL
created_at timestamptz
updated_at timestamptz
```

Capabilities are declarative and may include:

- `ade`;
- architecture;
- Docker support;
- browser/e2e support;
- memory class;
- project labels.

Do not store runner authentication secrets here.

## `executions`

Global record of one privileged dispatch attempt.

Suggested fields:

```text
id uuid PK
project_id uuid FK
runner_id uuid FK NULL
ade_execution_ref text NULL
work_ref text NULL
capability text
status text CHECK queued|leased|dispatched|running|succeeded|failed|cancelled|unknown
attempt integer
requested_at timestamptz
started_at timestamptz NULL
finished_at timestamptz NULL
result_summary jsonb NULL
error_code text NULL
error_summary text NULL
created_at timestamptz
updated_at timestamptz
```

`unknown` is important: it represents a state requiring reconciliation rather than automatic retry.

## `execution_leases`

Prevents concurrent duplicate dispatch.

Suggested fields:

```text
id uuid PK
execution_id uuid UNIQUE FK
project_id uuid FK
runner_id uuid FK NULL
owner_id text
lease_key text UNIQUE
acquired_at timestamptz
heartbeat_at timestamptz
expires_at timestamptz
released_at timestamptz NULL
release_reason text NULL
```

### Lease rules

- acquisition is atomic;
- a lease is persisted before privileged dispatch;
- expiration does not by itself prove that execution failed;
- stale leases trigger reconciliation;
- lease takeover requires an explicit recovery path;
- never reuse an execution identity for a fresh privileged attempt.

## `provider_quota_snapshots`

Stores normalized provider usage state.

Suggested fields:

```text
id uuid PK
provider text
account_ref text
policy_state text CHECK normal|throttled|draining|blocked|unknown
used_percent numeric NULL
window_started_at timestamptz NULL
resets_at timestamptz NULL
observed_at timestamptz
expires_at timestamptz NULL
metadata jsonb
```

Provider-specific fields belong inside the adapter or carefully normalized `metadata`, not scheduler code.

## `control_commands`

Represents a human-initiated mutation from Dashboard or GitHub.

Suggested fields:

```text
id uuid PK
source text CHECK dashboard|github|system
actor_type text
actor_ref text
project_id uuid FK NULL
command_type text
payload jsonb
idempotency_key text NULL
status text CHECK received|authorized|rejected|applied|failed
received_at timestamptz
applied_at timestamptz NULL
result_summary jsonb NULL
```

### Rules

- all mutations are validated and authorized before application;
- GitHub webhook delivery/request identity participates in idempotency;
- payload is typed/validated before persistence where possible;
- sensitive values are rejected/redacted.

## `audit_events`

Append-only security/operations trail.

Suggested fields:

```text
id uuid PK
occurred_at timestamptz
category text
severity text
actor_type text
actor_ref text NULL
project_id uuid FK NULL
execution_id uuid FK NULL
runner_id uuid FK NULL
action text
reason text NULL
result text NULL
correlation_id text NULL
metadata jsonb
```

Audit events should answer:

- who/what caused this action?
- which project/execution/runner did it affect?
- why was it allowed or rejected?
- what happened?

Do not turn audit events into raw log storage.

## `github_deliveries`

Recommended for webhook deduplication and audit.

Suggested fields:

```text
delivery_id text PK
event_name text
repository_id text
received_at timestamptz
processed_at timestamptz NULL
status text CHECK received|ignored|processed|failed
error_code text NULL
```

Store normalized routing metadata, not full webhook bodies unless explicitly required.

## Derived state vs source of truth

The Dashboard may display derived summaries, but durable truth remains:

- ADE for project delivery state;
- PostgreSQL for global scheduling/control state;
- provider adapter for current quota observation;
- runner for current host execution observation.

Cached snapshots need freshness timestamps and must never silently masquerade as live truth.

## Transactions that matter

### Schedule + lease

The following must be coordinated so another worker cannot dispatch the same logical work:

1. validate project eligibility;
2. create execution intent;
3. atomically acquire unique lease;
4. commit;
5. only then request privileged runner work.

### Apply control command

1. persist command receipt/idempotency identity;
2. authorize actor/action;
3. apply mutation transactionally;
4. append audit event;
5. mark command applied.

### Completion

1. correlate runner result with execution ID;
2. reject duplicate/inconsistent completion safely;
3. update execution terminal state;
4. release lease;
5. append audit event;
6. trigger next scheduling wake-up.

## Explicitly not stored here

Do not model these as control-plane tables:

- ADE delivery graph;
- ADE backlog/issues graph;
- agent prompt context;
- full source code or diffs;
- project validation evidence already owned by ADE;
- provider secrets;
- GitHub private keys/tokens;
- runner authentication secrets.
