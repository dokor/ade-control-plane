# GitHub Actions → Raspberry Deployment Model

## Purpose

Prepare issue #36 without implementing the workflow yet.

The target is automatic deployment of the Control Plane after a validated `main` commit, while keeping production authority narrower than generic root/Docker access on a self-hosted runner.

## Trigger contract

Production deployment may run only for a commit that is already on `main` and has passed the required CI workflow.

Allowed patterns:

- `workflow_run` after successful CI on `main`;
- a reusable workflow called only from the trusted main workflow after tests succeed.

Do not execute privileged Raspberry deployment from an arbitrary PR workflow.

## Runner identity

Recommended dedicated system user:

```text
ade-deploy
```

The GitHub Actions runner should:

- use dedicated labels such as `self-hosted`, `linux`, `arm64`, `ade-deploy`;
- not run as root;
- not share the privileged ADE/Codex execution service account;
- have no generic `sudo` or Docker-group membership when a restricted wrapper can perform deployment.

## Privileged boundary

The workflow calls one allow-listed host wrapper, for example:

```text
sudo /opt/ade-control-plane/bin/deploy <expected-main-sha>
```

The sudo policy must not permit:

- `sudo bash`;
- `sudo sh`;
- arbitrary `sudo docker ...`;
- arbitrary environment-variable preservation into root;
- user-controlled command/path substitution.

The deploy wrapper validates its inputs and uses fixed known paths.

## Deployment phases

```text
CI success on main
→ acquire deployment concurrency lock
→ verify requested SHA belongs to trusted main history
→ prepare checkout/image for exact SHA
→ backup/check migration safety as required
→ run migrations
→ update Compose services
→ wait for healthchecks
→ record deployed SHA
→ finish success
```

If healthcheck fails, workflow fails visibly. Automatic database rollback is not required and must not be attempted blindly after a potentially destructive migration.

## Checkout/image strategy

#26 decides the concrete runtime strategy. #36 should reuse it rather than invent a second deployment model.

Acceptable V0 options:

### Host checkout + Compose build

Simple for a private homelab:

- trusted host checkout under fixed path;
- deploy wrapper fetches exact trusted SHA;
- build/recreate with fixed Compose file.

### Prebuilt OCI images

Useful later if reproducibility/build time becomes important:

- CI builds ARM64/multi-arch images;
- image digest tied to Git SHA;
- deploy wrapper pulls exact digest/tag.

Do not block the first deployment solely to introduce a registry if host builds are adequate.

## Concurrency

Only one production deployment at a time.

GitHub workflow concurrency should cancel/queue appropriately, but the host wrapper should also use a local deployment lock so two runner processes cannot race.

## Secrets

Prefer host/runtime secret files for long-lived service credentials. GitHub Environment secrets should contain only values the deployment workflow truly needs.

Avoid piping full application secret sets through GitHub Actions when the Raspberry can retain protected runtime files locally.

The deployment workflow must never echo `.env`, secret files or inherited environment dumps.

## Healthchecks

After deployment verify at least:

- PostgreSQL healthy;
- Dashboard/API healthy locally;
- worker running/expected state;
- external Dashboard HTTPS route reachable if practical;
- database/worker ports remain private.

A healthcheck should validate service readiness, not expose sensitive diagnostics.

## Deployed version evidence

Record the exact deployed Git SHA in at least:

- GitHub Actions logs/summary;
- host deployment state file or equivalent;
- Dashboard diagnostics/build metadata when implementation supports it.

This allows a production screenshot/log to be mapped back to source.

## Rollback

Manual V0 rollback:

1. pause scheduling;
2. identify last known-good SHA/image;
3. assess migration compatibility;
4. restore DB backup only when required and understood;
5. deploy known-good application version;
6. verify health;
7. reconcile incomplete executions;
8. resume explicitly.

Never automatically roll back a destructive database migration just because an HTTP healthcheck failed.

## Security tests before enabling automatic CD

- PR workflow cannot target the production self-hosted runner with privileged deployment step;
- invalid SHA/ref is refused by deploy wrapper;
- concurrent deploy attempt is refused/serialized;
- `ade-deploy` cannot execute generic Docker or root shell commands;
- deployment logs contain no app/provider credentials;
- a failed healthcheck returns non-zero and leaves clear recovery instructions;
- manual deployment path still works when GitHub Actions is unavailable.
