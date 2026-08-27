# Product Target

## Core objective

ADE Control Plane exists to orchestrate the use of **AI Delivery Engine (ADE) across many projects** from one always-on Raspberry deployment.

A managed project can be:

- a new project created with ADE;
- an existing project retrofitted with ADE;
- any repository that exposes the supported ADE control-plane entry points and capability/version contract.

The control plane must not require a project to have been created by the control plane itself. Registration is enough when the repository/ADE integration passes the compatibility check.

## Source-of-truth boundary

ADE remains responsible for deciding what work is valid/runnable **inside one project**:

- project delivery graph;
- issue/task dependencies;
- project-specific ordering constraints;
- validations and gates;
- human decisions;
- execution details.

ADE Control Plane is responsible for deciding **which runnable unit across all managed projects gets the next execution slot**.

The control plane may carry GitHub issue references, ordering metadata and safe summaries returned by ADE, but it must not reconstruct ADE's delivery graph or infer dependencies from repository content.

## GitHub-first work interaction

GitHub is the canonical external work/validation surface for project delivery.

For a project whose ADE adapter exposes GitHub-backed runnable work, the normal lifecycle is:

```text
GitHub issue/backlog
→ ADE reports the next runnable issue/action
→ Control Plane places it in the global runnable queue
→ Scheduler selects one eligible project/work item
→ runner invokes ADE for that work reference
→ ADE performs the delivery loop
→ branch / commit / PR / checks
→ human validation when required
→ ADE exposes the next runnable work
```

The Control Plane does not arbitrarily reorder issue dependencies owned by ADE. It does preserve and expose the order/runnable state reported by ADE, then applies global scheduling policy across projects.

## Multi-project continuity

A human gate in one project must not freeze the whole orchestrator.

Example:

```text
Project A — issue #42 → waiting-human
Project B — issue #18 → runnable
Project C — issue #7  → runnable
```

The scheduler may continue with B or C while A remains visible in the human-attention queue. When A receives the required validation through GitHub or the Dashboard, it becomes eligible again on the next scheduling cycle.

Only a global pause, quota hard block, runner unavailability/security condition, or the absence of runnable work should stop all scheduling.

## Dashboard target

Once deployed on the Raspberry, the Dashboard is the global supervision surface.

### Global overview

It must make it easy to see:

- all registered ADE projects, old or new;
- project status and ADE-reported stage/milestone/progress;
- currently running project + issue/action;
- global runnable queue: next GitHub issues/actions that ADE currently considers runnable;
- blocked/waiting queue with explicit reason;
- human-attention queue with links/actions;
- recent executions and PR links;
- scheduler explanation: why an item is next, waiting or excluded;
- current Codex quota and reset information;
- Codex quota history over the last 30 days;
- runner/system health.

### Queue semantics

The Dashboard queue is a **supervision/read model**, not a second delivery backlog.

Each queue item should contain only safe global metadata such as:

- project ID/name;
- ADE work reference;
- GitHub issue/PR reference when available;
- summary/title;
- ADE-reported sequence/runnable state when available;
- global priority;
- waiting/blocking reason;
- eligible runner requirements;
- age/last observation.

The underlying dependency graph and delivery state remain in ADE.

## Codex quota history

Quota observation should remain simple.

Every successful quota read stores a normalized snapshot. The Dashboard only needs a rolling **30-day history** for the initial product.

Minimum stored/displayed values when exposed by Codex:

- used percentage;
- policy state;
- window/reset time;
- observed timestamp;
- freshness/expiry metadata.

Rules:

- never invent a value Codex does not expose;
- one persisted snapshot per actual quota observation is sufficient;
- duplicate-equivalent observations may optionally be compacted later if storage becomes noisy;
- retain at least the latest 30 days for Dashboard history;
- snapshots older than 30 days may be deleted by a simple scheduled cleanup unless longer retention is explicitly configured later;
- raw provider responses and credentials are not stored.

No billing/cost analytics platform is required for this feature.

## Scheduling target

At each scheduling wake-up, conceptually:

```text
refresh quota
→ refresh ADE summaries/runnable work for enabled projects
→ build global runnable candidates
→ remove waiting-human / paused / blocked / incompatible candidates
→ apply quota + runner hard gates
→ rank by explicit project priority and fairness/aging
→ select one work item
→ acquire durable lease
→ invoke ADE with the exact project/work reference
→ persist result
→ refresh GitHub/Dashboard state
→ continue with another eligible item
```

A project waiting on human validation remains supervised but does not consume an execution slot.

## Human validation

Human decisions can be completed from either supported human interface:

- GitHub for project/issue/PR-scoped validation;
- Dashboard for global supervision and supported targeted decisions.

Once a decision is accepted, the Control Plane forwards the typed decision to ADE and wakes the scheduler. ADE remains responsible for validating that the decision reference/options are valid for the project run.

## Non-goals

- duplicating ADE's internal backlog/delivery graph in PostgreSQL;
- inventing issue dependencies from GitHub text;
- forcing all projects to use the same technology stack;
- requiring projects to have been created through the Dashboard;
- stopping all projects because one project waits for a person;
- building detailed billing/cost accounting for Codex;
- automatically merging or deploying generated project code without a separately approved policy.
