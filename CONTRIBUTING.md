# Contributing

## Scope

ADE Control Plane is a security-sensitive orchestration system. Changes should be small, issue-scoped and explicit about failure/recovery behavior.

Read `AGENTS.md` first when working with an automated coding agent.

## Before coding

1. Select a GitHub issue.
2. Check its dependencies.
3. Read the relevant docs under `docs/`.
4. Identify whether the change touches a trust boundary, credential, privileged execution, persistence/recovery or public API.
5. Keep the change focused.

## Branches

Recommended naming:

```text
feat/2-project-persistence
feat/11-runner-protocol
fix/lease-recovery
security/github-webhook-replay
```

## Commits

Prefer conventional, descriptive commits:

```text
feat(database): add atomic execution lease acquisition
test(runner): reject workspace symlink escape
docs(github): document actor authorization
fix(worker): reconcile stale execution before retry
```

## Pull requests

A PR should normally correspond to one issue or one coherent sub-capability.

Describe:

- what changed;
- why;
- issue reference;
- architecture/security impact;
- persistence/migration impact;
- failure/recovery behavior;
- how it was tested.

## Required checks

At minimum:

```bash
pnpm typecheck
pnpm test
```

Additional security/integration checks are required as the repository gains those workflows.

## Testing expectations

Test both happy paths and important negative paths.

Examples:

- duplicate lease acquisition fails safely;
- stale lease enters reconciliation rather than automatic duplicate execution;
- unauthorized control command is rejected and audited;
- invalid GitHub signature is rejected;
- duplicate GitHub delivery is idempotent;
- runner replayed request is rejected;
- workspace traversal/symlink escape is rejected;
- stale/unknown quota follows explicit policy;
- provider/runner errors are redacted.

## Database changes

- use versioned migrations;
- migrations are reviewed application code;
- avoid destructive migrations without rollback/backup reasoning;
- preserve audit/recovery history;
- never add project delivery graph tables owned by ADE.

## Security-sensitive changes

Security-sensitive code includes:

- Dashboard authentication/session handling;
- GitHub webhook/authorization logic;
- worker-runner protocol;
- runner process execution;
- path/workspace handling;
- credentials/secrets;
- Docker/systemd/network configuration;
- execution retry/recovery;
- audit/redaction.

Such PRs must explain which threat from `docs/SECURITY.md` is affected and include tests or verifiable configuration.

## Dependencies

Keep dependencies minimal.

Before adding a package, ask whether platform/standard-library functionality is sufficient. Privileged services especially should avoid unnecessary dependency surface.

Commit and maintain the lockfile once dependency installation is established.

## API changes

For external/internal APIs or contracts, document:

- authentication;
- authorization;
- schema/version;
- timeout;
- idempotency/replay semantics;
- audit behavior;
- error/retry classification;
- secret/redaction policy.

## Definition of done

Work is complete when:

- issue acceptance criteria are met;
- typecheck/tests are green;
- relevant failure paths are covered;
- docs/contracts are synchronized;
- security invariants remain true;
- no unrelated architecture is introduced;
- the PR can explain what happens after process/network failure.