# Dashboard

## Purpose

The Dashboard is the global supervision and control surface for ADE Control Plane.

It must answer quickly:

- what is running?
- what is waiting and why?
- which project will likely run next?
- what quota remains?
- is the Raspberry runner healthy?
- which human decisions need attention?
- what changed recently?

It is not a replacement for ADE's project-specific delivery UI/state and must not reconstruct ADE's internal graph.

## Primary users

MVP assumes a very small trusted user set. Authentication is mandatory even if there is only one user.

## Information architecture

### `/` — Overview

Top-level cards:

- global scheduler state: running / globally paused / degraded;
- provider quota state and reset time;
- runner health;
- active execution;
- projects needing human attention.

Project table/cards:

- name;
- enabled/paused/disabled;
- priority;
- ADE-reported stage/milestone;
- current work summary;
- waiting reason;
- active runner;
- last successful execution;
- next eligibility summary.

The overview should explain why no work is running when the system is idle.

### `/projects/[id]` — Project detail

Show:

- repository link;
- control-plane state and priority;
- latest ADE snapshot freshness;
- ADE stage/milestone/current work/next work summary;
- current waiting reason;
- recent executions;
- scheduler decisions affecting this project;
- human decisions requiring action;
- relevant GitHub issue/PR links;
- recent audit-safe timeline.

Controls:

- pause;
- resume;
- reprioritize;
- request safe retry when classified retryable;
- forward/resolve a known human decision where supported.

Do not show controls unsupported by the current project/ADE capabilities.

### `/runners`

Show safe runner metadata:

- runner name/id;
- online/offline/draining/disabled;
- architecture;
- capabilities;
- current execution count;
- last heartbeat;
- recent safe failures.

Controls may include:

- drain runner;
- disable runner;
- re-enable runner.

Do not expose process command lines, environment variables, secret paths or unrestricted filesystem data.

### `/activity`

Optional V1 page or overview section showing a merged timeline of:

- scheduler decisions;
- execution transitions;
- quota policy transitions;
- runner state changes;
- authorized control commands;
- security-relevant rejected commands in sanitized form.

### `/settings`

Keep minimal in MVP.

Possible safe settings:

- default quota thresholds;
- scheduler global pause;
- project registration/enablement;
- authorized GitHub actor configuration;
- diagnostics/build version.

Secrets should not be editable/displayed as plaintext through normal settings UI unless a dedicated secure secret workflow is explicitly designed.

## Status model

Prefer explicit user-facing states:

- `running`;
- `ready`;
- `waiting-human`;
- `waiting-quota`;
- `waiting-runner`;
- `paused`;
- `failed`;
- `reconciling`;
- `completed`;
- `unknown`.

`unknown` and `reconciling` must be visible rather than silently rendered as failed/idle.

## Scheduler explanation

Every scheduler cycle should provide enough structured information for the Dashboard to show messages such as:

> Argos selected because priority 80, runnable work available, quota normal and raspberry-local compatible.

or:

> No project dispatched: DVV paused; Argos waiting for human decision; Project X requires browser capability unavailable on current runner.

This explainability is a core product feature, not debug-only output.

## Quota UI

Display:

- provider/account label;
- normalized policy state;
- usage percentage when known;
- relevant window/reset time;
- snapshot age;
- next planned quota refresh.

When quota data is stale/unknown, explicitly show that scheduling is operating under the configured unknown/stale policy.

Do not fabricate a percentage when provider data does not expose one.

## Human attention

Create a dedicated attention queue/card for:

- ADE human decisions;
- reconciliation requiring manual input;
- authorization/configuration errors;
- repeated infrastructure failure after backoff threshold.

Each item should include:

- project;
- concise reason;
- age;
- safe recommended action;
- GitHub link when relevant;
- Dashboard action when available.

## Control API semantics

Dashboard mutations become typed `ControlCommand` records.

Do not let React/HTTP handlers mutate scheduler state ad hoc.

Conceptually:

```text
Dashboard action
→ authenticated API request
→ authorize action
→ validate typed command
→ persist ControlCommand + audit identity
→ apply transactional global state mutation or queue wake-up
→ worker observes new state
```

Runner work never executes directly from a public Dashboard request.

## Authentication

MVP requirement: authenticated access only.

Possible implementation options should be evaluated for simplicity and attack surface. For a private homelab deployment, acceptable directions include:

- authentication at application layer with secure session cookies;
- trusted identity proxy in front of the application plus application-side identity validation.

Do not rely solely on an obscure URL or network location as authentication.

If reverse proxy authentication is used, clearly define which headers are trusted and ensure direct access to the app cannot bypass the proxy.

## Authorization

Even single-user MVP should distinguish read vs mutation in code so future policy does not require rewriting handlers.

Sensitive actions:

- global pause/resume;
- runner disable/enable;
- project resume after security block;
- retry of privileged failed execution;
- human decision submission.

These actions must create durable audit records.

## CSRF / browser security

For cookie-authenticated mutation endpoints:

- use appropriate SameSite cookies;
- validate origin/CSRF token as applicable;
- secure + HttpOnly session cookies;
- no state changes via GET;
- CSP and security headers appropriate to Next.js deployment;
- avoid exposing stack traces/internal secrets to browser errors.

## Live updates

Start simple.

Preferred order:

1. server-rendered/read API + controlled polling;
2. SSE for lightweight event updates if needed;
3. WebSockets only if bidirectional real-time needs justify them.

Do not make realtime transport a dependency of core scheduling.

## Mobile-first operational use

The Dashboard should remain usable on a phone because it is the primary global remote control surface.

Prioritize:

- readable project status cards;
- clear attention queue;
- large safe action targets;
- confirmation for sensitive commands;
- no critical information hidden behind hover-only UI.

## Error presentation

Expose sanitized, actionable summaries:

- stable error code;
- human summary;
- project/execution correlation ID;
- recommended safe action.

Do not display:

- raw provider responses containing sensitive metadata;
- environment dumps;
- auth headers/tokens;
- unrestricted runner stderr;
- filesystem secrets.

## V1 acceptance

Dashboard V1 is useful when:

- at least two projects are visible with distinct states;
- global quota and runner health are visible;
- scheduler idle/running reason is understandable;
- recent project execution timeline is visible;
- pause/resume/reprioritize work through audited commands;
- waiting-human state is actionable;
- mobile layout is usable;
- no direct privileged runner operation is exposed from the public request path.