# Crash-Safe Worker

The worker starts by reconciling durable non-terminal executions before any new
scheduling. A runner response that cannot prove a terminal result remains
`unknown` and is reconciled later; it is never retried as fresh work.

The loop has no host shell capability. Project work is requested through the
typed runner client only. Global `paused` and `safe_mode` states sleep without
dispatching. Idle cycles, quota resets and infrastructure failures use explicit
delays; `SIGTERM` and `SIGINT` request a graceful stop after the active typed
operation returns.
