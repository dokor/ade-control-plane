# Codex Quota Adapter

The control plane reads the stable Codex App Server JSON-RPC method
`account/rateLimits/read`. In production, the worker starts App Server on its
own loopback interface, negotiates the documented `initialize` handshake and
requests one snapshot before claiming new work. App Server owns the Codex
authentication state in its `CODEX_HOME`; credentials are never placed in the
WebSocket URL or persisted by the control plane.

The adapter accepts the current `rateLimitsByLimitId.codex` response and the
documented legacy `rateLimits` fallback. It considers both exposed windows and
selects the most constrained one for the deterministic global gate. The other
window is represented only by bounded metadata. This avoids assuming which
Codex model consumes which bucket.

Only provider fields that are actually present are normalized. A missing or
invalid `usedPercent` remains `null`, a missing reset remains absent, and the
policy evaluates the snapshot as `unknown`/fail-closed when appropriate. Raw
JSON-RPC responses, auth headers and provider errors never reach PostgreSQL,
logs or the Dashboard.

Compose fixes the endpoint to `ws://127.0.0.1:4500` inside the worker. There
is no App Server port, external listener, or Traefik route to configure. The
runtime still accepts a different endpoint for isolated development tests only.

Successful observations are persisted with the derived policy state and are
pruned with a provider/account-scoped rolling 30-day retention while always
preserving the latest snapshot. A failed read leaves the last observation
unchanged; freshness and the configured conservative policy determine whether
new work may start.
