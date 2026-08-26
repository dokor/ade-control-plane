# Runner Protocol

## Purpose

The host runner is the privileged execution boundary between the containerized control plane and ADE/Codex/Git/build tooling on the Raspberry host.

The worker may ask the runner to perform a **typed capability**. It may not send an arbitrary shell command.

## Trust boundary

```text
Docker trust zone                     Host runner trust zone

control-plane worker  ── authenticated request ──>  raspberry-local runner
                                                     ├── ADE
                                                     ├── Codex
                                                     ├── Git
                                                     └── project workspace
```

The runner is not publicly reachable.

## Protocol goals

- typed/versioned requests;
- authenticated caller;
- integrity-protected payload;
- replay protection;
- request expiry;
- project/capability allow-list;
- strict workspace containment;
- execution correlation;
- bounded execution time;
- explicit cancellation/reconciliation semantics;
- sanitized responses.

## Transport

The first implementation should prefer a local/private transport with the smallest attack surface.

Good MVP options:

1. Unix domain socket mounted or proxied into the worker in a narrowly scoped way;
2. loopback/private HTTP listener bound only to the host/private interface plus strong mutual authentication.

Do not expose the runner through the public reverse proxy.

The exact transport is implementation detail; the application contract below remains stable.

## Request envelope

Conceptual TypeScript shape:

```ts
type RunnerRequest = {
  protocolVersion: "1";
  requestId: string;
  executionId: string;
  projectId: string;
  capability: RunnerCapability;
  workspaceRef: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  lease: {
    leaseId: string;
    leaseKey: string;
  };
  limits: {
    timeoutMs: number;
    maxOutputBytes?: number;
  };
  input: unknown;
};
```

The authenticated transport/signature covers all fields.

## Initial capability set

```ts
type RunnerCapability =
  | "ade.status"
  | "ade.runnable-work"
  | "ade.advance"
  | "ade.apply-decision"
  | "execution.reconcile";
```

No `shell.execute` capability exists in the MVP.

Future capabilities require a security review and explicit typed input schema.

## Capability inputs

### `ade.status`

Input:

```ts
{
  projectRef: string;
}
```

Output: normalized ADE project status or transport-neutral failure.

### `ade.runnable-work`

Input:

```ts
{
  projectRef: string;
}
```

Output: normalized runnable-work summary or `null`.

### `ade.advance`

Input:

```ts
{
  projectRef: string;
  workRef?: string;
  controlPlaneExecutionId: string;
}
```

The runner delegates to ADE. The control plane must not translate this into lower-level project graph operations itself.

### `ade.apply-decision`

Input:

```ts
{
  projectRef: string;
  decisionRef: string;
  option: string;
  actorRef: string;
}
```

ADE validates the project-level decision semantics.

### `execution.reconcile`

Input:

```ts
{
  controlPlaneExecutionId: string;
  adeExecutionRef?: string;
}
```

Used after worker/runner restart or ambiguous transport failure.

## Validation order

The runner rejects a request before touching project files or starting processes unless all checks pass:

1. protocol version supported;
2. caller authentication valid;
3. integrity/signature valid;
4. request not expired;
5. nonce/request ID not already consumed;
6. execution/lease identity structurally valid;
7. project exists in local allow-list;
8. capability allowed for that project/runner;
9. workspace reference resolves under the configured project root;
10. limits are within runner policy;
11. request input validates against capability schema.

Unknown fields should be rejected for privileged request schemas unless explicitly designed for forward compatibility.

## Replay protection

Use at least:

- unique `requestId`;
- unique nonce;
- short request expiry;
- persistent or restart-safe consumed request identity for the relevant replay window;
- execution/lease correlation.

A valid signature on an old request is not enough to authorize replay.

## Workspace containment

For every operation:

1. map `projectId` to a locally configured canonical root;
2. resolve/canonicalize requested workspace path;
3. reject paths outside the root;
4. reject unsafe symlink escape patterns;
5. do not accept raw absolute workspace paths from remote input as authority.

Workspace identifiers should preferably be opaque references mapped by the runner.

## Local process execution

The runner may internally start ADE/Git/build processes, but it must construct those invocations itself from typed inputs.

Rules:

- avoid shell interpolation;
- use argument arrays/process APIs;
- maintain an allow-list of executable entrypoints;
- environment variables are allow-listed;
- secrets are injected only into the process that needs them;
- stdout/stderr are bounded and redacted;
- process groups are terminated on timeout/cancel;
- no inherited interactive TTY for automated work unless explicitly required.

## Response envelope

```ts
type RunnerResponse = {
  protocolVersion: "1";
  requestId: string;
  executionId: string;
  runnerId: string;
  status: "accepted" | "running" | "succeeded" | "failed" | "unknown" | "rejected";
  adeExecutionRef?: string;
  startedAt?: string;
  finishedAt?: string;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    retryability: "never" | "safe" | "reconcile-first";
  };
};
```

Provider/stack traces and secrets must be sanitized before returning to the worker.

## Error semantics

Important classes:

- `AUTHENTICATION_FAILED` — never retry unchanged;
- `AUTHORIZATION_FAILED` — never retry unchanged;
- `REQUEST_REPLAYED` — audit and reject;
- `REQUEST_EXPIRED` — caller may create a fresh request if work is still eligible;
- `PROJECT_NOT_ALLOWED` — configuration/security error;
- `WORKSPACE_CONTAINMENT_FAILED` — security event;
- `CAPABILITY_NOT_ALLOWED` — security/configuration error;
- `EXECUTION_ALREADY_TERMINAL` — idempotent response/reconcile;
- `EXECUTION_STATE_UNKNOWN` — reconcile before retry;
- `ADE_FAILED` — project-level failure summary;
- `RUNNER_RESOURCE_UNAVAILABLE` — scheduler may wait/select another compatible runner.

## Heartbeat and health

Runner heartbeat exposes only safe metadata:

```ts
{
  runnerId,
  protocolVersion,
  state,
  architecture,
  capabilities,
  activeExecutionCount,
  observedAt
}
```

Do not expose environment dumps, filesystem paths beyond stable logical identifiers, tokens or process command lines containing sensitive values.

## Cancellation

Cancellation is a typed control operation bound to an existing execution identity.

It must not mean "kill arbitrary PID".

The runner maps the execution ID to the process group it owns and applies the configured termination policy.

## Recovery

On runner startup:

1. inspect runner-owned execution journal/state if implemented;
2. identify processes/workspaces associated with non-terminal executions;
3. expose reconciliation result to the control plane;
4. never assume a stale lease alone means the previous external action did not complete.

## Authentication recommendation

For one Raspberry MVP, prefer a simple mechanism that is strong and easy to rotate, such as:

- dedicated shared secret used for HMAC over canonical request payload plus nonce/expiry; or
- mutually authenticated local TLS if private HTTP is selected.

The secret is dedicated to worker<->runner and not reused for GitHub, Database or Codex.

Store it outside Git and make rotation possible without rebuilding images.

## Audit

The control plane records the authoritative global audit event. The runner should additionally log safe local security events for:

- rejected authentication;
- replay attempts;
- containment failures;
- capability violations;
- process timeout/cancellation;
- runner startup/recovery.

Logs must be structured and redacted.