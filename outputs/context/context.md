# Project Context

> Generated deterministically by `ade context generate` from local sources.
> No secrets, environment values or file contents are included.

- Schema version: 1
- Fingerprint: `e39bd6c111d74fea6b00cfa4a8661bac7220113e871d6b3dfbb5d5ffd3a0ea6b`

## Stack

- Name: ade-control-plane
- Version: 0.0.0
- Module type: module
- Package manager: pnpm@10.15.0
- Engines: node >=22
- Dependencies (1): @ade-control-plane/host-runner
- Dev dependencies (3): @types/node, tsx, typescript

## Packages

- `apps/dashboard` — @ade-control-plane/dashboard
- `apps/worker` — @ade-control-plane/worker
- `packages/ade-client` — @ade-control-plane/ade-client
- `packages/core` — @ade-control-plane/core
- `packages/database` — @ade-control-plane/database
- `packages/github` — @ade-control-plane/github
- `packages/host-runner` — @ade-control-plane/host-runner
- `packages/quota` — @ade-control-plane/quota
- `packages/runner-protocol` — @ade-control-plane/runner-protocol

## Modules

- none

## Commands

- `dev:dashboard`: `pnpm --filter @ade-control-plane/dashboard dev`
- `dev:worker`: `pnpm --filter @ade-control-plane/worker dev`
- `test`: `pnpm -r --if-present test`
- `typecheck`: `pnpm -r --if-present typecheck && tsc --noEmit -p runner/tsconfig.json`

## Conventions

- `development/service-size` (warn):

## Entry Points

- none

## Sensitive Zones (declared, excluded from context)

- `.env*`
- `**/*.key`
- `**/*.pem`
- `**/secrets.*`

## Architecture Decision Records

- none
