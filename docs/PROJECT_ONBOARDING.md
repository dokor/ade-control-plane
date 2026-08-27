# ADE Project Onboarding

## Purpose

Define one onboarding path for both existing repositories and new ADE projects.

The Control Plane must not care whether a repository was created before or after ADE Control Plane. A project is eligible when its repository identity and ADE control-plane contract are valid.

## Required inputs

- human project name/slug;
- GitHub repository owner/name and numeric repository ID when discovered;
- ADE adapter kind/version;
- ADE project reference;
- scheduling priority;
- required runner capabilities/labels;
- optional quota policy override;
- local runner project mapping where applicable.

No ADE delivery graph, prompt pack or secret is copied into Control Plane configuration.

## Compatibility check

Before scheduling is enabled, perform a read-only check through the configured ADE adapter.

Expected checks:

1. adapter/version supported;
2. project reference resolves;
3. `status` capability available;
4. runnable-work capability available when orchestration requires it;
5. advance capability available;
6. apply-decision capability advertised when project can require human decisions;
7. reconcile capability advertised for crash-safe execution where required;
8. response schema/version valid;
9. repository identity matches the registered project where ADE exposes that information.

Missing optional capabilities should be visible in the Dashboard; missing mandatory capabilities block enablement.

## Existing repository flow

```text
existing GitHub repo
→ install/configure ADE entry points
→ register repository in Control Plane
→ configure runner-local project mapping
→ run read-only compatibility check
→ inspect detected capabilities
→ save paused/disabled
→ explicitly enable scheduling
```

The Control Plane must not force repository re-initialization or migration if ADE can already operate it.

## New project flow

```text
new GitHub repo / ADE-initialized project
→ ensure ADE control-plane entry points are available
→ register repository in Control Plane
→ configure runner mapping
→ same compatibility check
→ explicitly enable scheduling
```

After registration, old and new projects use the exact same orchestration path.

## Runner-local mapping

The runner owns host filesystem paths.

Recommended shape:

```yaml
projects:
  argos:
    root: /srv/ade-projects/argos
    allowedCapabilities:
      - ade.status
      - ade.runnable-work
      - ade.advance
      - ade.apply-decision
      - ade.reconcile
```

The Dashboard/Control Plane sends logical project IDs/references, never arbitrary host paths supplied by a browser or GitHub comment.

## Initial state

A newly registered project should begin `paused` or `disabled`.

Enable only after:

- compatibility check succeeds;
- GitHub repository mapping is verified;
- required runner exists;
- credentials for the intended Git operations are available to the correct privileged component;
- no security/configuration warning remains unexplained.

## GitHub integration

When GitHub interaction is enabled:

- GitHub App installation must include the repository;
- numeric repository ID must match the project record;
- webhook routing must resolve to exactly one project;
- project-level issue/PR links can be carried as safe references returned by ADE;
- issue text itself never becomes a scheduling dependency rule inside Control Plane.

## Dashboard onboarding result

After registration the project view should be able to show:

- compatibility status;
- ADE adapter/capability version;
- last successful ADE status observation;
- scheduling state;
- priority;
- compatible runner(s);
- GitHub repository link;
- current waiting reason if not eligible;
- clear explanation of any missing capability/configuration.

## Removal / disablement

Prefer disable/archive over destructive deletion.

A project must not be destructively removed while:

- active task/execution exists;
- execution lease exists;
- reconciliation is pending;
- durable audit/history still references it unless deletion semantics are explicitly designed.

## Acceptance scenarios for #37

- an old repository retrofitted with ADE passes onboarding and becomes runnable;
- a new ADE project passes the same onboarding code path;
- unsupported ADE version is visible and blocked;
- missing `runnable-work` blocks autonomous orchestration but does not prevent safe status display if `status` exists;
- repository mismatch is rejected;
- enabling scheduling is an explicit audited action, never a side effect of registration.
