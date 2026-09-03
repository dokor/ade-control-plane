# Crash-Safe Worker

The worker starts by reconciling durable non-terminal executions before any new
scheduling. A runner response that cannot prove a terminal result remains
`unknown` and is reconciled later; it is never retried as fresh work.

The loop has no host shell capability. Project work is requested through the
typed runner client only. Global `paused` and `safe_mode` states sleep without
dispatching. Idle cycles, quota resets and infrastructure failures use explicit
delays; `SIGTERM` and `SIGINT` request a graceful stop after the active typed
operation returns.

## GitHub-work ownership

GitHub-work leases are renewed while the dispatcher is alive. A renewal failure
or workflow deadline aborts the process and completes the execution as
`unknown`, with reconciliation required; it is never treated as a safe retry.
The worker also reconciles stale GitHub-work executions at startup before
dispatching new work. Operator cancellation remains distinct and completes as
`cancelled` only after the owned process observes the cancellation.
