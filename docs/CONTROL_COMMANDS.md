# Control Commands

## Purpose

Dashboard and GitHub must produce the same durable, typed control intents instead of implementing separate mutation semantics.

A `ControlCommand` is the audited boundary between human input and control-plane state changes.

It does not contain arbitrary shell commands or arbitrary ADE commands.

## Envelope

Conceptual shape:

```ts
type ControlCommand = {
  id: string;
  version: 1;
  source: "dashboard" | "github" | "system";
  actor: {
    type: "user" | "github-user" | "system";
    ref: string;
  };
  projectId?: string;
  type: ControlCommandType;
  payload: unknown;
  idempotencyKey?: string;
  receivedAt: string;
};
```

Authorization is based on authenticated actor + command type + target, not on fields supplied by the client alone.

## MVP command types

```ts
type ControlCommandType =
  | "project.pause"
  | "project.resume"
  | "project.priority.set"
  | "scheduler.pause"
  | "scheduler.resume"
  | "scheduler.safe-mode"
  | "runner.drain"
  | "runner.disable"
  | "runner.enable"
  | "execution.retry"
  | "ade.decision.apply";
```

Read-only queries such as status do not need to become durable mutation commands, though access may still be logged where useful.

## Project pause/resume

### `project.pause`

Payload:

```ts
{
  reason?: string;
}
```

Effect: prevents new scheduling for the project. Existing active execution policy must be explicit; default pause does not silently kill active work.

### `project.resume`

Payload:

```ts
{
  reason?: string;
}
```

Resume is rejected when a stronger block remains, such as:

- disabled project;
- unresolved security block;
- reconciliation requirement;
- invalid project configuration.

## Priority

### `project.priority.set`

```ts
{
  priority: number;
}
```

Validate configured bounded range. Repeated application of the same target value is idempotent.

## Global scheduler

### `scheduler.pause`

No new privileged dispatch. Observation and reconciliation continue.

### `scheduler.resume`

Resume only when security/configuration invariants permit it.

### `scheduler.safe-mode`

Emergency/degraded state. No new privileged dispatch; allow safe observation/reconciliation/admin recovery operations.

Leaving safe mode should require an explicit authorized command rather than automatic recovery.

## Runner lifecycle

### `runner.drain`

Runner finishes existing work but receives no new dispatch.

### `runner.disable`

Administratively blocks runner from new work. Does not mean kill arbitrary processes.

### `runner.enable`

Allowed only after health/security/config validation.

## Retry

### `execution.retry`

```ts
{
  executionId: string;
}
```

Rules:

- retry classification `safe` → may create a **new execution identity/attempt** after eligibility checks;
- `never` → reject;
- `reconcile-first` → reject until reconciliation proves a safe next action;
- never reuse the old execution ID for a fresh side-effecting attempt.

The command asks the control plane to schedule a safe retry; it does not directly execute runner work in the HTTP/webhook handler.

## ADE decision

### `ade.decision.apply`

```ts
{
  decisionRef: string;
  option: string;
}
```

Rules:

- target project required;
- decision must exist in the latest trusted ADE summary/reference;
- option must be one ADE exposed as valid;
- ADE remains final authority on project decision semantics;
- control plane forwards a typed decision through worker/runner/ADE path.

## Lifecycle

Persisted command state:

```text
received
  ├── rejected
  └── authorized
        ├── applied
        └── failed
```

Recommended flow:

1. authenticate source/actor;
2. derive server-side actor identity;
3. validate schema and target;
4. persist receipt + idempotency identity;
5. authorize command;
6. mark rejected + audit if unauthorized/invalid;
7. apply transactional control-plane mutation or enqueue durable wake-up intent;
8. audit result;
9. mark applied/failed;
10. worker observes new durable state when privileged execution is needed.

## Idempotency

Dashboard:

- mutations should accept/generate an idempotency key for actions vulnerable to double-click/retry;
- simple target-state operations such as setting priority to 80 are naturally idempotent but still have one command record per accepted logical request.

GitHub:

- derive from webhook delivery + comment/event identity + parsed command;
- duplicate webhook must return/reuse the already-known logical result rather than create a new side effect.

## Authorization matrix — conceptual MVP

| Command | Dashboard trusted operator | Authorized GitHub actor |
| --- | --- | --- |
| project.pause/resume | yes | yes, project-scoped |
| project.priority.set | yes | yes, if policy allows |
| scheduler.pause/resume | yes | no by default |
| scheduler.safe-mode | yes | no by default |
| runner.drain/disable/enable | yes | no by default |
| execution.retry | yes | project-scoped if classified safe |
| ade.decision.apply | yes | yes, project-scoped |

GitHub is intentionally narrower than Dashboard for global infrastructure operations.

## Audit fields

Every mutation should produce safe audit metadata including:

- command ID;
- source;
- actor ref;
- project/execution/runner target where applicable;
- action type;
- reason when supplied and sanitized;
- authorization outcome;
- result/error code;
- correlation ID;
- timestamp.

Do not include secret values or unrestricted human/external payloads in audit metadata.

## Input limits

Human reasons/comments forwarded into commands should have explicit size limits and sanitization.

Unknown fields in privileged mutation schemas should generally be rejected.

## Public-path rule

Neither Dashboard API nor GitHub webhook handlers call runner capabilities directly.

The public path creates/updates durable trusted control state. The worker is the component that later evaluates gates, acquires leases and dispatches typed runner work.
