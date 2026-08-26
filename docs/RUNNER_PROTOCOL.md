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

## Selected MVP transport: Unix Domain Socket

For `raspberry-local`, use a **Unix Domain Socket (UDS)** as the initial transport because the worker container and privileged runner live on the same Raspberry host.

Recommended shape:

```text
Host runtime directory
/run/ade-control-plane-runner/
└── runner.sock
        ▲
        │ narrowly bind-mounted into worker container
        │
control-plane worker
```

The host runner owns the socket. Filesystem owner/group/mode restrict who can connect. The worker container receives access only to the narrow runtime directory/socket, never to the host filesystem broadly.

Use a simple typed request protocol over the socket; HTTP over UDS is acceptable because Node supports Unix socket clients/servers and it avoids inventing custom network framing.

### Why UDS for the MVP

- no TCP runner listener;
- no runner port to expose/firewall;
- local filesystem permissions add a trust boundary;
- easy to keep outside the public reverse proxy;
- still compatible with application-level HMAC, expiry and anti-replay;
- transport can later be replaced by authenticated HTTPS/mTLS for remote runners without changing domain contracts.

Do not treat possession of socket access as sufficient authorization by itself: application-level authentication/integrity and replay checks remain required.

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

The authenticated signature covers the canonical request payload and security-relevant headers/metadata.

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

```ts
{
  projectRef: string;
}
```

Output: normalized ADE project status or transport-neutral failure.

### `ade.runnable-work`

```ts
{
  projectRef: string;
}
```

Output: normalized runnable-work summary or `null`.

### `ade.advance`

```ts
{
  projectRef: string;
  workRef?: string;
  controlPlaneExecutionId: string;
}
```

The runner delegates to ADE. The control plane must not translate this into lower-level project graph operations itself.

### `ade.apply-decision`

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

## Authentication and integrity

For the single-host MVP, use a **dedicated worker-runner shared secret** for HMAC authentication over a canonical representation of the request.

The HMAC input should bind at least:

- protocol version;
- request ID;
- execution/project IDs;
- capability;
- issued/expiry timestamps;
- nonce;
- lease identity;
- canonical serialized input hash/body.

The secret is dedicated to worker<->runner and is not reused for GitHub, PostgreSQL, Dashboard auth or Codex.

Store it outside Git and make rotation possible without rebuilding images.

UDS filesystem permissions are defense in depth, not a replacement for HMAC validation.

## Replay protection

Use at least:

- unique `requestId`;
- unique nonce;
- short request expiry;
- restart-safe consumed request identity for the relevant replay window;
- execution/lease correlation.

A valid HMAC on an old request is not enough to authorize replay.

## Workspace containment

For every operation:

1. map `projectId` to a locally configured canonical root;
2. resolve/canonicalize requested workspace reference;
3. reject paths outside the root;
4. reject unsafe symlink escape patterns;
5. do not accept raw absolute workspace paths from remote input as authority.

Workspace identifiers should preferably be opaque references mapped by the runner.

## Local process execution

The runner may internally start ADE/Git/build processes, but it constructs invocations itself from typed inputs.

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

## Runtime directory hardening

Suggested runtime location:

```text
/run/ade-control-plane-runner/
```

Requirements:

- directory created with controlled owner/group/mode;
- contains only runner IPC/runtime material intended for the worker;
- socket removed/recreated safely on runner restart;
- worker container mounts only this directory or socket, not `/run` generally;
- no secret file needs to be placed beside the socket unless permissions and ownership are explicitly designed for it.

## Remote runners later

A future remote runner may implement the same application contract over HTTPS/mTLS.

Remote transport must be added behind the runner adapter; it must not weaken local runner validation rules or require scheduler changes.

## Audit

The control plane records the authoritative global audit event. The runner additionally logs safe local security events for:

- rejected authentication;
- replay attempts;
- containment failures;
- capability violations;
- process timeout/cancellation;
- runner startup/recovery.

Logs must be structured and redacted.