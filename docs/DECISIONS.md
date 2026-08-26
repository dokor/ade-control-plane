# Architecture Decisions

This file records decisions already accepted for the MVP. Reopening one is allowed, but should require an explicit issue/ADR explaining why the trade-off changed.

## D1 — ADE remains project-scoped

**Decision:** ADE owns project understanding, delivery graph, project run state, execution loops, validations, decisions and delivery evidence.

**Control Plane:** only supervises multiple ADE projects globally.

**Reason:** avoid creating a second delivery engine and preserve ADE as independently usable.

## D2 — Separate repository

**Decision:** ADE Control Plane lives in its own repository rather than being embedded in ADE.

**Reason:** different lifecycle, security boundary and deployment model; ADE must remain usable without the always-on control plane.

## D3 — Raspberry is the always-on control plane

**Decision:** Raspberry Pi 5 is the first production target.

**Reason:** the always-on orchestration layer should not depend on a workstation; orchestration is lightweight because model inference is remote.

## D4 — Option C deployment topology

**Decision:** Dashboard, worker and PostgreSQL are containerized. The privileged `raspberry-local` runner is a separate host service.

**Reason:** the runner needs Git/process/workspace/build privileges that must not leak into the public-facing Dashboard or scheduler container.

## D5 — No Docker socket in control-plane containers

**Decision:** Dashboard and worker never receive `/var/run/docker.sock` or equivalent generic Docker host control.

**Reason:** Docker socket access is effectively host-level privilege and collapses the intended trust boundary.

## D6 — Typed runner capabilities only

**Decision:** worker->runner protocol exposes typed/versioned capabilities such as `ade.status` and `ade.advance`. No generic remote shell capability exists in the MVP.

**Reason:** minimize RCE blast radius and make authorization/audit/replay behavior explicit.

## D7 — Dashboard + GitHub only

**Decision:** the two human interfaces are:

- Dashboard for global supervision/control;
- GitHub for project issues/PRs/targeted decisions.

**Reason:** smaller scope, lower maintenance and smaller external attack surface.

## D8 — PostgreSQL is global source of truth

**Decision:** PostgreSQL stores durable control-plane state, leases, audit and queue-like coordination.

**Reason:** avoid adding Redis/distributed infrastructure before a demonstrated need; transactions are useful for leases/recovery.

## D9 — Control plane does not copy ADE graph state

**Decision:** PostgreSQL may cache ADE summaries but does not model the ADE delivery graph/backlog as control-plane truth.

**Reason:** preserve ownership boundary and prevent divergent state.

## D10 — Explicit `unknown/reconciling` states

**Decision:** ambiguous privileged execution outcome is not classified as ordinary failure.

**Reason:** blindly retrying after transport/process crashes can duplicate side effects. Reconciliation comes first.

## D11 — Security is release-blocking

**Decision:** issue #10 security gates must pass before the H24 Raspberry deployment is considered ready.

**Reason:** the system coordinates privileged development automation and long-lived credentials; hardening cannot be deferred until after deployment.

## D12 — No automatic production deployment in MVP

**Decision:** development/PR preparation may be automated, but automatic production deployment authority is not granted by default.

**Reason:** production is a materially higher-risk permission and is not necessary to prove the control-plane concept.

## D13 — Provider quotas are deterministic gates

**Decision:** quota state is normalized and evaluated by code/policy, not delegated to an LLM.

**Reason:** cost/usage limits must be predictable and explainable.

## D14 — GitHub App preferred

**Decision:** prefer GitHub App credentials over broad PATs when implementing the final GitHub integration.

**Reason:** repository-scoped permissions, short-lived installation tokens and native webhook identity provide better least privilege.

## D15 — Dashboard mutations become ControlCommands

**Decision:** Dashboard HTTP handlers do not directly perform runner work or mutate scheduling internals ad hoc.

**Reason:** one auditable command path can be shared with GitHub and keeps public HTTP handling separate from privileged execution.

## D16 — Restore requires reconciliation

**Decision:** restoring PostgreSQL never immediately resumes scheduling.

**Reason:** runner/ADE/external state can be newer than a restored database snapshot; non-terminal executions must be reconciled first.

## D17 — Local runner transport uses a Unix Domain Socket

**Decision:** the `raspberry-local` MVP transport uses a Unix Domain Socket in a narrowly scoped runtime directory, with application-level HMAC authentication, request expiry and replay protection.

**Reason:** worker and runner are on the same host. UDS avoids exposing a TCP runner listener and allows filesystem permissions to provide an additional trust boundary. Future remote runners can implement the same application contract over authenticated HTTPS/mTLS.
