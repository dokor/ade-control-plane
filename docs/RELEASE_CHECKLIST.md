# Production Release Qualification Checklist

## Purpose

Turn issue #10 security gates and the deployment acceptance criteria into one checklist that can be executed before calling the Raspberry deployment production-ready.

This checklist records evidence; it does not replace automated tests.

## Build / source

- [ ] Exact Git SHA identified.
- [ ] CI is green for the deployed SHA.
- [ ] Lockfile is committed and used.
- [ ] GitHub Actions permissions are minimal.
- [ ] Third-party Actions are pinned to reviewed SHAs.
- [ ] No repository secret is present in committed files/history introduced by the release.

## Dashboard / public surface

- [ ] Dashboard requires authentication.
- [ ] Session cookie is Secure/HttpOnly with intended SameSite policy.
- [ ] Mutations reject cross-origin requests.
- [ ] Error responses contain stable sanitized summaries, not stack traces/secrets.
- [ ] Only intended Dashboard/API ports/routes are externally reachable.
- [ ] GitHub webhook is signature-authenticated and body-size limited.

## PostgreSQL

- [ ] PostgreSQL has no public host port.
- [ ] Persistent data lives on SSD-backed storage.
- [ ] Application DB credentials are not defaults/examples.
- [ ] Migration ran successfully for the deployed SHA.
- [ ] One backup was created before/around release.
- [ ] Backup location/age is visible operationally.

## Worker / execution

- [ ] Worker is not publicly reachable.
- [ ] No Dashboard/worker application container mounts Docker socket.
- [ ] No public HTTP request can directly execute Codex/Git/host shell.
- [ ] One active-work limit / lease policy behaves as designed for current release.
- [ ] Restart does not blindly replay an ambiguous privileged execution.
- [ ] Stop/Cancel behavior has been exercised.

## Repository isolation

- [ ] Project root is explicit and allow-listed.
- [ ] Path traversal is rejected.
- [ ] Symlink escape test runs on Linux/Raspberry.
- [ ] Git remote mismatch is rejected.
- [ ] Test execution cannot modify another registered project checkout.

## Credentials

- [ ] Dashboard session secret separated from DB/GitHub/Codex credentials.
- [ ] Codex credential is available only to the execution component that needs it.
- [ ] Git push credential is not exposed to browser/GitHub comments/model context.
- [ ] GitHub App private key is not exposed to Codex/Git subprocesses unnecessarily.
- [ ] No credential appears in persisted task logs after failure-path tests.
- [ ] Rotation owner/procedure known for each credential in `SECRET_MATRIX.md`.

## GitHub

- [ ] GitHub App installed only on intended repository/repositories.
- [ ] Authorized actor IDs configured explicitly.
- [ ] Invalid webhook signature rejected.
- [ ] Duplicate delivery has no duplicate side effect.
- [ ] Bot sender cannot drive its own command loop.
- [ ] `@ade` unknown/invalid command is refused rather than guessed.
- [ ] GitHub command cannot assert that an unsafe retry is safe.

## Codex / quota

- [ ] Provider credential is not persisted in quota tables/logs.
- [ ] Missing quota percentage remains unknown/null.
- [ ] Stale quota is visible as stale and follows conservative policy.
- [ ] 30-day retention contract is implemented before claiming quota history complete.

## Raspberry / Docker

- [ ] Containers intended to be non-root run as non-root.
- [ ] No application service uses privileged mode.
- [ ] `no-new-privileges` applied where practical.
- [ ] Linux capabilities dropped by default where practical.
- [ ] Volume mounts match documented allow-list.
- [ ] Restart policies return services after host reboot.
- [ ] Reverse proxy/TLS exposes only intended surface.

## E2E acceptance

- [ ] Dashboard opened through real production URL.
- [ ] Test task created from Dashboard.
- [ ] Task reaches RUNNING.
- [ ] Real Codex modifies only intended repo.
- [ ] `ade/<task-id>` branch created.
- [ ] Commit pushed.
- [ ] Real GitHub PR created.
- [ ] Dashboard reaches SUCCESS and links PR.
- [ ] Raspberry rebooted and history remains available.

## Recovery / incident

- [ ] Global pause/safe mode can be activated without SSH for normal operations.
- [ ] Runner/execution can be stopped through documented privileged path.
- [ ] Known credential can be revoked/rotated independently.
- [ ] Recent privileged actions can be identified from audit data.
- [ ] Restore procedure exists and a restore exercise is scheduled/completed before full H24 qualification.

## CD qualification (#36)

When automatic deployment is enabled:

- [ ] PR workflow cannot run privileged production deploy.
- [ ] only trusted successful `main` SHA deploys;
- [ ] deployment concurrency is serialized;
- [ ] deploy account is non-root;
- [ ] deploy account lacks generic sudo/Docker authority;
- [ ] deploy wrapper validates exact trusted paths/ref;
- [ ] failed healthcheck fails the workflow;
- [ ] exact deployed SHA is recorded;
- [ ] manual fallback/rollback remains documented.

## Sign-off evidence

Attach to the relevant GitHub issue/release:

- deployed SHA;
- CI run;
- sanitized `docker compose ps` / health result;
- E2E task ID and PR URL;
- known exceptions with linked follow-up issues;
- date/operator performing qualification.
