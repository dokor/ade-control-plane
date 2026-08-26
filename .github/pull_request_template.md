## Summary

<!-- What changed and why? -->

Closes #

## Scope

- [ ] Change is focused on one issue/coherent capability.
- [ ] No ADE project-delivery logic was duplicated in the control plane.

## Architecture impact

<!-- Which package/trust boundary/state machine changes? -->

## Security impact

- [ ] No security-sensitive behavior changed.
- [ ] Security-sensitive behavior changed and is explained below.

Threat/control affected:

<!-- Reference docs/SECURITY.md where relevant. -->

## Persistence / migration impact

- [ ] None.
- [ ] Migration/schema change included and reviewed.

## Failure and recovery behavior

<!-- What happens on timeout, crash, duplicate delivery, unknown completion, restart? -->

## Testing

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] Relevant negative/security paths tested.

Details:

## Operational impact

<!-- Secrets, env, Docker, systemd, backup/rollback, deployment changes? -->

## Checklist

- [ ] External/provider formats remain behind adapters.
- [ ] Privileged operations are typed and auditable.
- [ ] Secrets are not logged/persisted/exposed to model context.
- [ ] Retry behavior is classified (`safe`, `never`, or `reconcile-first`) when relevant.
- [ ] Documentation/contracts were updated if observable behavior changed.
