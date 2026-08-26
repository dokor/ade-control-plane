# Core State Machines

## Purpose

ADE Control Plane should use explicit states for scheduling, executions, runners and commands. Ambiguous booleans make crash recovery and security reasoning much harder.

These states describe **global control-plane state** only. ADE retains its own project-delivery states.

## Project scheduling state

```text
enabled
paused
disabled
```

### `enabled`

Project may participate in scheduling if every other hard gate passes.

### `paused`

Project remains registered and observable but cannot receive new work.

Pause can be initiated by an authorized human or a control-plane policy that explicitly maps to a paused state.

### `disabled`

Project is administratively excluded from scheduling, typically for configuration/offboarding/security reasons.

## Project eligibility result

Eligibility is derived, not persisted as the sole truth.

Possible result:

```text
ready
waiting_ade
waiting_human
waiting_quota
waiting_runner
leased
paused
disabled
security_blocked
reconciling
completed
unknown
```

Every non-ready state must carry a machine-readable reason and safe human summary.

## Execution state

```text
queued
leased
dispatched
running
succeeded
failed
cancelled
unknown
```

Allowed conceptual flow:

```text
queued
  ↓
leased
  ↓
dispatched
  ↓
running
  ├── succeeded
  ├── failed
  ├── cancelled
  └── unknown
```

Transitions may skip `running` when the underlying adapter completes synchronously, but durable intent/lease ordering still applies.

### `unknown`

This is a critical first-class state.

Use it when the system cannot prove whether privileged external work completed, for example:

- runner connection lost after dispatch;
- worker crash before completion acknowledgement;
- provider/transport ambiguity.

`unknown` must enter reconciliation. It must not automatically become `failed` and be blindly retried.

## Lease state

A lease is represented by timestamps rather than a separate enum, but conceptual states are:

```text
active
stale
released
```

### Important rule

`stale` means ownership/heartbeat is no longer current. It does **not** prove that the external execution did not finish.

A stale lease with a non-terminal execution triggers reconciliation.

## Runner state

```text
online
draining
offline
disabled
```

### `online`

Eligible for compatible new work.

### `draining`

May finish active execution but receives no new work.

### `offline`

Heartbeat/health unavailable. Not eligible.

### `disabled`

Explicitly administratively blocked, potentially due to incident response.

## Quota policy state

```text
normal
throttled
draining
blocked
unknown
```

### `normal`

Normal scheduling.

### `throttled`

Reduce concurrency or low-priority starts according to configured policy.

### `draining`

Avoid new expensive work; allow active execution to finish.

### `blocked`

No new provider-consuming execution may start.

### `unknown`

Provider usage data is unavailable/stale beyond policy tolerance.

Default MVP security/cost posture should be fail-closed or explicitly conservative for unknown state, never silently equivalent to `normal`.

## Control command state

```text
received
authorized
rejected
applied
failed
```

Flow:

```text
received
  ├── rejected
  └── authorized
        ├── applied
        └── failed
```

The audit trail records both rejected and applied privileged commands.

## GitHub delivery state

```text
received
ignored
processed
failed
```

A duplicate delivery should be handled idempotently based on delivery ID rather than reprocessed as new work.

## Human decision lifecycle

The control plane does not own project-level decision semantics. It tracks the interaction/reference necessary to route decisions to ADE.

Conceptually:

```text
ADE reports decision required
→ control plane records attention item/reference
→ Dashboard/GitHub presents allowed options
→ authorized human selects option
→ ControlCommand persisted
→ runner receives typed ade.apply-decision
→ ADE validates/applies
→ control plane refreshes ADE snapshot
```

Do not create a second control-plane decision engine that can contradict ADE.

## Scheduler cycle state

A worker cycle should produce one terminal cycle result such as:

```text
dispatched
idle
waiting_quota
waiting_human
waiting_runner
globally_paused
reconciling
error
```

The result includes:

- reason;
- project/execution if applicable;
- quota/runner context;
- next recommended wake-up time or trigger.

## Global scheduler mode

```text
running
paused
safe_mode
```

### `running`

Normal scheduling.

### `paused`

No new executions; observability/health/reconciliation may continue.

### `safe_mode`

Incident/degraded mode. No new privileged dispatch. Allow only explicitly safe diagnostics, recovery observation and administrative actions.

A global pause/safe-mode capability is part of incident response.

## Retry classification

Failures should carry explicit retry semantics:

```text
never
safe
reconcile_first
```

### `never`

Configuration, authorization or deterministic validation failure. Do not retry unchanged.

### `safe`

Operation failed before privileged side effects or is demonstrably idempotent.

### `reconcile_first`

Side-effect completion is uncertain. Reconciliation is mandatory before any fresh attempt.

The Dashboard/GitHub `retry` action must respect this classification.