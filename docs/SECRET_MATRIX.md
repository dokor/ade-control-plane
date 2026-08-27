# Secret and Credential Matrix

## Purpose

Keep credentials separated by trust zone so compromise of one component does not automatically grant all control-plane, repository and provider privileges.

This matrix is the default. Any broader sharing requires an explicit security decision.

| Secret / credential | Owner | Needs read access | Must not receive it | Rotation impact |
| --- | --- | --- | --- | --- |
| Dashboard password hash | Dashboard | Dashboard only | worker, runner, Codex | operator login only |
| Dashboard session signing secret | Dashboard | Dashboard only | worker, runner, Codex, GitHub | invalidates active sessions |
| PostgreSQL app credential | Dashboard/worker as needed | relevant app services | Codex/model, GitHub comments | reconnect services |
| GitHub App private key | GitHub integration | Dashboard/API integration or dedicated GitHub service | Codex, generic runner subprocesses | GitHub API/auth only |
| GitHub webhook secret | webhook receiver | Dashboard/API webhook route | worker, Codex, Git subprocesses | webhook verification only |
| Git push credential | privileged execution zone | V0 worker or host runner Git environment | Dashboard/browser, Codex environment when separable | project Git push only |
| Codex API/auth credential | Codex execution zone | Codex subprocess/runtime | Git commands, Dashboard, GitHub webhook | AI execution only |
| worker→runner HMAC secret | worker + host runner | those two components only | Dashboard/browser, Codex, GitHub | local runner channel only |
| deployment sudo authority | host OS policy | `ade-deploy` only for allow-listed deploy wrapper | app containers, Codex, PR workflows | CD path only |

## Rules

- Never reuse one token because two components both happen to talk to GitHub.
- Do not export the parent process environment wholesale into Codex or Git subprocesses.
- Prefer constructing explicit child environments from allow-listed variables.
- Secret file paths may be configured, but file contents must never be persisted as project configuration.
- Logs should contain secret identifiers/references only when useful, never values.
- Dashboard diagnostics may report `configured / missing / expired` but not plaintext values.

## File permissions target

For host secret files, default toward owner-readable only, for example `0600`, with directory permissions restricting traversal to the owning service account.

Do not solve access by making `/etc/ade-control-plane/secrets` globally readable.

## Rotation procedure template

For each credential:

1. pause new scheduling if the credential affects privileged execution;
2. create/retrieve replacement through the owning provider;
3. install replacement in protected runtime storage;
4. restart only components that need the credential;
5. verify health/authentication;
6. revoke old credential;
7. record sanitized audit/operations evidence;
8. resume scheduling.

## Incident mapping

### Dashboard session secret suspected leaked

Rotate only Dashboard session secret and force re-login. GitHub/Codex/Git credentials should remain unaffected.

### GitHub App key suspected leaked

Pause GitHub command handling if needed, rotate App key, verify installation tokens. Do not rotate Codex solely because the GitHub App key changed.

### Codex credential suspected leaked

Pause scheduling, stop active Codex execution when safe, revoke/rotate provider credential. GitHub App and Dashboard sessions remain independent.

### Git push credential suspected leaked

Pause affected project(s), rotate repository credential, inspect recent pushes/audit. Codex provider credential remains separate.

## Acceptance check

Before #26/#36 are considered production-ready, verify from runtime configuration that Codex and Git subprocesses receive different credential sets and that Dashboard containers cannot read host project Git/Codex secret files unnecessarily.
