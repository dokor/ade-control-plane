# Scheduler

`@ade-control-plane/core` exposes a pure `evaluateSchedule` function. Its input
contains only global control-plane state and a compact ADE adapter result; it
does not receive repository content or the ADE delivery graph.

Before ranking, each candidate must pass global mode, project state, ADE
freshness/human/reconciliation, security, lease, quota and runner-compatibility
gates. A decision records one safe exclusion code per candidate, compatible
runner IDs, and a quota reset wake-up when available.

GitHub work is ordered by its explicit priority only among work items whose
dependencies are currently completed. A `waiting-human`, blocked, or
dependency-waiting item remains in the durable GitHub-work projection. Its
persisted state and dependency references let the scheduler present the wait
reason, but it does not hold a lease or prevent a lower-ranked eligible item
from being selected. When reconciliation observes the dependency completed or a
human decision resolved, the item becomes a candidate again without a manual
task recreation.

Eligible work ranks by descending project priority. Equal priorities use the
oldest successful execution first, then project ID and runner ID as stable
tie-breaks. Only `online` runners are eligible for new work. Runner matching is
typed: architecture, labels, Docker, browser, memory class and ADE capabilities.

Quota is fail-closed for `unknown` and `blocked`. The default policy also holds
low-priority work while throttled and long work while draining. The worker must
acquire the durable lease and persist dispatch intent after selection; a scheduler
decision alone never authorizes execution.
