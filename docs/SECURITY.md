# Security

## Goal

ADE Control Plane coordinates privileged development automation across multiple repositories. A compromise of the Dashboard, worker, runner or GitHub integration must not automatically imply unrestricted host, repository, secret or production access.

Security is therefore enforced through explicit trust boundaries, least privilege, typed contracts, auditability and fail-closed behavior.

## Trust zones

### Zone 1 — Public/control surface

Components:

- Dashboard;
- control API;
- reverse proxy.

Allowed responsibilities:

- authentication;
- read-only supervision;
- creation of explicit control commands;
- presentation of sanitized logs/events.

Forbidden capabilities:

- generic shell execution;
- direct Git credentials;
- direct Codex/provider credentials unless strictly required for read-only metadata;
- Docker socket;
- direct host filesystem access;
- direct project worktree access.

### Zone 2 — Control-plane worker

Components:

- scheduler;
- quota manager;
- project registry;
- lease/recovery logic;
- GitHub notification/command dispatch.

Allowed responsibilities:

- choose a project based on global state;
- acquire/release leases;
- request typed runner operations;
- persist global state;
- call provider quota/status APIs through scoped adapters;
- publish project-scoped GitHub interactions through a dedicated integration.

Forbidden capabilities:

- arbitrary host shell execution;
- arbitrary project filesystem access;
- generic Docker host control;
- bypass of ADE project gates.

### Zone 3 — PostgreSQL

Contains:

- global project registry;
- leases;
- execution metadata;
- quota snapshots;
- audit trail;
- command state;
- GitHub delivery deduplication state.

Rules:

- private network only;
- unique DB credentials for services where practical;
- no public port;
- backups encrypted or access-controlled;
- secrets stored as references or encrypted values, not plaintext application logs;
- migrations reviewed like application code.

### Zone 4 — Host runner

Components:

- ADE;
- Codex/provider client;
- Git;
- project worktrees;
- build/test tooling;
- optional Docker/browser tooling.

This is the highest-privilege execution zone and must not be directly reachable from the public network.

Rules:

- dedicated service account;
- per-project allow-list;
- strict workspace root containment;
- typed commands only;
- explicit capability policy;
- timeouts and resource limits;
- no implicit production credentials;
- credentials scoped independently from Dashboard/worker credentials.

### Zone 5 — GitHub integration

GitHub is the only external project interaction surface.

Rules:

- validate webhook signatures before parsing actionable content;
- deduplicate delivery IDs and reject stale/replayed command events;
- treat issue, PR and comment content as untrusted input;
- authorize the GitHub actor and repository for every control command;
- use minimum GitHub App/fine-grained permissions;
- never translate comment text directly into shell or ADE command strings.

## Primary threats

### Remote command execution through control inputs

Threat: malicious Dashboard/API/GitHub input becomes a shell command on the runner.

Controls:

- no arbitrary command string in runner API;
- versioned command enum/contract;
- server-side validation;
- fixed argument builders;
- path canonicalization and containment checks;
- shell disabled unless a specific ADE capability requires it;
- user-controlled strings never interpolated into shell commands.

### Prompt injection / malicious repository content

Threat: repository text, issue/PR content, README or generated output attempts to instruct an agent to exfiltrate secrets or escape the workspace.

Controls:

- ADE remains owner of model context and tool permissions;
- sensitive files excluded from context by default;
- secrets never embedded in prompts;
- network/tool permissions explicit per execution;
- agent output treated as untrusted data until validated;
- no agent authority to change security policy, quotas, permissions or production gates.

### Credential theft

Threat: compromise of one component reveals GitHub, provider or runner credentials.

Controls:

- least privilege and separate credentials per integration;
- no credentials committed to Git;
- secrets injected at runtime;
- secrets never written to audit events;
- credential rotation documented;
- tokens redacted before persistence;
- prefer short-lived/app-based credentials when practical.

### Runner impersonation / forged execution

Threat: an attacker sends a fake execution request or replays a previous valid request.

Controls:

- authenticated worker-to-runner channel;
- unique execution ID;
- nonce or monotonic request identity;
- replay cache/DB check;
- request expiry;
- lease ownership check;
- project/runner binding validation;
- response correlation with execution ID.

### Forged or replayed GitHub interaction

Threat: an attacker forges a webhook or replays a previously authorized command.

Controls:

- verify webhook signature;
- verify repository installation/scope;
- authorize actor for the requested control action;
- deduplicate webhook delivery IDs;
- use command idempotency keys;
- persist command state before privileged execution;
- reject unsupported or ambiguous command syntax.

### Dashboard account compromise

Threat: access to Dashboard results in destructive project operations.

Controls:

- authenticated access only;
- authorization per control action;
- dangerous actions require stronger confirmation/gate;
- no generic privileged action endpoint;
- complete audit trail;
- production actions disabled by default.

### Supply-chain compromise

Threat: malicious npm/Docker dependency compromises control plane or runner.

Controls:

- lockfile required;
- pinned major images and controlled updates;
- CI dependency/security scanning;
- minimal runtime images;
- avoid unnecessary dependencies;
- review Dockerfiles and GitHub Actions permissions;
- no untrusted PR execution with production secrets.

### Lateral movement between projects

Threat: execution for Project A reads/modifies Project B.

Controls:

- isolated worktree/workspace per execution;
- canonical project root allow-list;
- execution bound to one project ID;
- credentials scoped per repository where practical;
- runner rejects paths outside assigned workspace;
- cleanup does not follow arbitrary symlinks.

### Database or log data leakage

Threat: prompts, source snippets, secrets or tokens become visible through Dashboard/logs/backups.

Controls:

- structured logging with allow-listed fields;
- centralized redaction before persistence;
- payload size/content limits;
- no raw environment dumps;
- no full request headers/tokens in errors;
- sanitized error rendering in Dashboard.

## API and interaction requirements

All internal/external APIs must define:

- authentication mechanism;
- authorization policy;
- request schema and size limits;
- idempotency/replay behavior;
- timeout;
- rate limiting where relevant;
- audit event generated;
- secret/redaction behavior;
- failure mode.

Unknown fields and unsupported capability requests should be rejected rather than silently accepted.

## Dashboard / control API

- authentication is mandatory before any project state is returned;
- authorization is evaluated per control command;
- mutating requests use CSRF/origin protections appropriate to the selected authentication design;
- privileged actions are audited before and after execution;
- API error responses are sanitized;
- no endpoint accepts arbitrary command/script payloads.

## GitHub

- prefer GitHub App or fine-grained tokens over broad classic PATs;
- minimum repository permissions required by each operation;
- webhook signatures must be validated;
- webhook delivery IDs must be deduplicated;
- actor/repository authorization is required for control commands;
- comments/issues/PR content are untrusted input;
- merge/production permissions are not granted to the MVP by default;
- commands are translated into typed `ControlCommand` objects, never shell/ADE strings.

## Codex / AI providers

- provider credentials remain in the component that needs them;
- quota/status access should use minimum capability possible;
- model-generated content cannot alter quota policy or security policy;
- model/tool calls are tied to execution ID/project ID;
- provider errors are sanitized before storage/display.

## Docker / Raspberry host

Control-plane containers:

- non-root users;
- no Docker socket;
- no privileged mode;
- `no-new-privileges`;
- drop capabilities by default;
- private database network;
- read-only filesystem where practical;
- only Dashboard port exposed;
- explicit volume allow-list.

Host:

- runner uses a dedicated Unix account;
- SSH access hardened separately from application access;
- firewall exposes only required services;
- project workspaces live under a dedicated root;
- persistent DB data is stored on SSD and backed up;
- OS/container updates are part of operations.

## Security gates

The following are release-blocking for the first always-on deployment:

1. authenticated Dashboard/control API;
2. GitHub webhook signature, delivery deduplication and actor authorization enforced;
3. PostgreSQL not publicly exposed;
4. worker and Dashboard have no Docker socket;
5. runner is not publicly reachable;
6. authenticated worker-runner protocol with replay protection;
7. typed runner command contract with no arbitrary shell command;
8. project workspace containment tests;
9. secrets/redaction tests;
10. durable audit events for privileged actions;
11. dependency/container security checks in CI;
12. restart/recovery cannot duplicate privileged executions;
13. production deployment credentials absent from the MVP runner by default.

## Incident response minimum

The system must make it possible to:

- pause all scheduling;
- revoke/rotate GitHub and provider credentials independently;
- disable a runner;
- identify recent privileged actions from audit events;
- identify which project/workspace an execution touched;
- stop the runner service without taking PostgreSQL/Dashboard data offline;
- restore PostgreSQL from a known backup.

## Rule

When convenience and security conflict in privileged execution, default to the narrower capability and require an explicit design decision to broaden it.
