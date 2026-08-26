# Observability

## Purpose

Observability must make the control plane explainable and operable without turning logs/metrics into a new source of sensitive data.

The system should answer:

- is the control plane healthy?
- why is nothing running?
- what execution changed state?
- which project/runner/quota gate affected a scheduling decision?
- is recovery/reconciliation required?
- is a component stale or unavailable?

## Three outputs

### Audit events

Security/privileged-action history. Durable and structured.

Examples:

- project paused/resumed;
- runner disabled;
- GitHub command rejected/accepted;
- execution dispatched/completed/reconciled;
- replay/path-containment violation.

Audit is not raw application logging.

### Application logs

Operational diagnostic stream for Dashboard/API, worker and runner.

Structured JSON recommended.

### Metrics/health

Low-cardinality operational measurements and component health/freshness.

Metrics must not contain project source, prompts, tokens or unrestricted user text.

## Correlation model

Use stable IDs to correlate components:

- `project_id`;
- `execution_id`;
- `runner_id`;
- `control_command_id`;
- `request_id` for runner IPC;
- GitHub delivery ID where applicable;
- generic `correlation_id` for one logical operation.

Do not correlate using secrets, repository content or raw provider request IDs if they may contain sensitive meaning.

## Structured log fields

Recommended common fields:

```text
timestamp
level
service
message_code
correlation_id
project_id?
execution_id?
runner_id?
command_id?
event
result?
duration_ms?
error_code?
```

Human-readable `message` may be generated, but stable `message_code/event/error_code` should support filtering.

## Forbidden log content

Never log by default:

- Authorization headers;
- cookies/session tokens;
- GitHub App private key/webhook secret;
- runner HMAC secret/signatures in reusable form;
- database passwords/full credential URLs;
- Codex/provider credentials;
- full environment dumps;
- unrestricted prompts/source code/diffs;
- complete webhook bodies;
- unrestricted stdout/stderr;
- filesystem contents outside safe logical identifiers.

## Redaction

Centralize redaction logic rather than relying on every caller to remember it.

Prefer allow-listed structured fields over regex-only cleanup.

Regex/token-shape redaction remains defense in depth for errors/log strings.

Redaction must be covered by a synthetic secret corpus in tests.

## Health model

### Dashboard/API

Health may include:

- process alive;
- DB connectivity;
- build/version;
- optional worker freshness summary.

Public reverse-proxy health endpoints should return minimal information.

Detailed diagnostics require authenticated Dashboard access.

### Worker

Track:

- last cycle at;
- last successful cycle at;
- current cycle/result;
- global scheduler mode;
- current/active execution ref;
- reconciliation count;
- last infrastructure error code.

### Runner

Safe heartbeat:

- runner ID;
- state;
- protocol version;
- architecture;
- capability names;
- active execution count;
- observed timestamp.

No env/process command lines/secret paths.

### Quota

Track:

- provider/account logical ref;
- normalized policy state;
- used percent if genuinely available;
- reset time if available;
- snapshot observed/freshness age;
- refresh failure code.

### Database

Track availability and pool/query health without logging SQL values containing sensitive payloads.

## Recommended MVP metrics

Keep cardinality controlled.

Examples:

```text
control_plane_scheduler_cycles_total{result}
control_plane_scheduler_dispatch_total
control_plane_scheduler_idle_total{reason}
control_plane_execution_total{status}
control_plane_execution_duration_seconds
control_plane_execution_unknown_current
control_plane_reconciliation_total{result}
control_plane_runner_online
control_plane_runner_heartbeat_age_seconds
control_plane_quota_state{state}
control_plane_quota_snapshot_age_seconds
control_plane_control_commands_total{source,type,result}
control_plane_github_deliveries_total{event,result}
control_plane_security_rejections_total{reason}
```

Avoid project IDs as metric labels if project count/cardinality grows; detailed project data belongs in DB/Dashboard queries.

## Scheduler decisions

Persist or retain enough structured decision information to explain:

- selected candidate;
- excluded candidates and reason codes;
- quota state;
- runner compatibility;
- lease/security/global-mode gates;
- next wake-up reason/time.

Do not turn every internal comparison into an unbounded verbose log payload.

Suggested reason codes:

```text
selected
project_paused
project_disabled
no_runnable_work
waiting_human
snapshot_stale
quota_blocked
quota_unknown
lease_conflict
security_blocked
reconciliation_required
no_compatible_runner
runner_unavailable
global_paused
safe_mode
```

## Timeline

Dashboard project/global timeline can merge normalized records from:

- audit events;
- execution state transitions;
- scheduler decisions;
- quota state transitions;
- runner state transitions;
- human/control commands.

The timeline is a presentation/read model; durable source tables retain their ownership.

## Error taxonomy

Prefer stable error codes over raw stack traces at boundaries.

Examples:

- `DATABASE_UNAVAILABLE`;
- `ADE_TIMEOUT`;
- `ADE_OUTPUT_INVALID`;
- `PROVIDER_QUOTA_UNAVAILABLE`;
- `RUNNER_UNAVAILABLE`;
- `RUNNER_AUTHENTICATION_FAILED`;
- `RUNNER_REQUEST_REPLAYED`;
- `WORKSPACE_CONTAINMENT_FAILED`;
- `GITHUB_SIGNATURE_INVALID`;
- `GITHUB_ACTOR_UNAUTHORIZED`;
- `EXECUTION_STATE_UNKNOWN`.

Internal stack traces can exist in protected runtime diagnostics after redaction, but should not be persisted/displayed blindly.

## Alert/attention philosophy

The MVP does not need a separate alerting platform to be useful.

The Dashboard attention queue should surface durable operational conditions such as:

- waiting-human;
- execution unknown/reconciliation;
- runner offline;
- quota data stale beyond policy;
- repeated infrastructure failures;
- database backup too old;
- low disk space when integrated operationally.

GitHub notifications stay project-specific and should not become a copy of global operations alerts.

## Retention

Define bounded retention for noisy application logs.

Audit history and execution metadata may have longer retention because they support recovery/security reasoning.

Do not keep large raw external payloads simply because storage is cheap.

## Dashboard freshness

Every externally observed/cache-like state should expose freshness:

- ADE snapshot observed at;
- runner heartbeat at;
- quota snapshot observed at;
- worker last cycle at.

A stale state must look stale, not like current truth.

## Future integration

Metrics can later be exported to an existing Prometheus/Grafana stack if desired, but the domain should not depend on Prometheus for correctness.

Logging/metrics failure must not silently disable security gates, durable leases or audit persistence required for privileged actions.
