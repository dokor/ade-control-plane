# ADE Adapter Contract

`@ade-control-plane/ade-client` receives only ADE summaries and typed operations. It must never inspect a project repository, a delivery graph or ADE's internal `ProjectRun` state to infer an answer.

## CLI Transport

`LocalProcessAdeClient` is the MVP transport adapter. The host runner owns the executable, workspace and process policy; the control plane only calls the transport-neutral `AdeClient` interface.

The adapter invokes a fixed argument shape without a shell:

```text
<command> [base args] control-plane <operation> --project <projectRef> --json [--input-json <json>]
```

The supported operations are `capabilities`, `status`, `runnable-work`, `advance`, `apply-decision` and `reconcile`. ADE must emit exactly one JSON envelope:

```json
{
  "protocolVersion": "1",
  "operation": "status",
  "value": {}
}
```

Every response is validated before it is normalized. Unknown fields, unsupported versions, invalid timestamps and malformed values are rejected. Process stdout/stderr is never included in `AdeClientError`; callers receive only a stable error code, sanitized message and retry classification.

## Current ADE Availability

AI Delivery Engine `0.11.0` exposes the versioned local project-setup contract
through `ade setup contract --json` and `ade setup check --json`. It also
exposes `project:status`, which reports local workflow artifacts but does not
provide the machine operations above. It therefore cannot yet be used as a
real control-plane target for `runnable-work`, `advance`, decisions or
reconciliation.

The worker consumes the setup contract during the mutating delivery preflight;
the separate process adapter below remains reserved for a future ADE
control-plane command surface.

The deterministic fake and the process adapter tests provide the contract coverage until ADE exposes these versioned commands. The first real ADE integration test belongs with the implementation of this command surface, without changing the scheduler or this domain contract.
