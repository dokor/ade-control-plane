# Scheduler

`@ade-control-plane/core` exposes a pure `evaluateSchedule` function. Its input
contains only global control-plane state and a compact ADE adapter result; it
does not receive repository content or the ADE delivery graph.

Before ranking, each candidate must pass global mode, project state, ADE
freshness/human/reconciliation, security, lease, quota and runner-compatibility
gates. A decision records one safe exclusion code per candidate, compatible
runner IDs, and a quota reset wake-up when available.

Eligible work ranks by descending project priority. Equal priorities use the
oldest successful execution first, then project ID and runner ID as stable
tie-breaks. Only `online` runners are eligible for new work. Runner matching is
typed: architecture, labels, Docker, browser, memory class and ADE capabilities.

Quota is fail-closed for `unknown` and `blocked`. The default policy also holds
low-priority work while throttled and long work while draining. The worker must
acquire the durable lease and persist dispatch intent after selection; a scheduler
decision alone never authorizes execution.
