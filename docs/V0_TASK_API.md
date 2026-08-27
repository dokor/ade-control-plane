# V0 Task API

Issue #23 adds the minimal durable path used by the V0 Codex worker and Dashboard. It deliberately does not use the multi-project scheduler, quota policy, runner protocol or ADE delivery graph.

## Lifecycle

```text
PENDING -> RUNNING -> SUCCESS
                   -> FAILED
                   -> CANCELLED
PENDING -----------> CANCELLED
```

PostgreSQL enforces at most one `PENDING` or `RUNNING` task globally with a partial unique index. Claiming a pending task and completing a running task are conditional atomic updates. A repeated terminal completion with the same result is idempotent; a different result is rejected.

Cancelling a pending task makes it `CANCELLED` immediately. Cancelling a running task persists `cancelRequested = true`; the worker remains responsible for stopping Codex and completing the task as `CANCELLED`. Terminal tasks are not mutated by late cancellation requests, and no cancellation causes an implicit retry.

## Dashboard HTTP API

All endpoints require the signed Dashboard session. Mutations additionally require mutation rights and a same-origin request.

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/api/tasks` | Return the 100 most recent tasks. |
| `POST` | `/api/tasks` | Create a pending task from `projectId` and `prompt`; return `409` when another task is active. |
| `GET` | `/api/tasks/{id}` | Return task detail and up to 2,000 log records. |
| `POST` | `/api/tasks/{id}/cancel` | Persist cancellation intent or cancel a pending task. |

Task prompts are limited to 20,000 characters. Each log message is redacted and limited to 4 KiB, with a durable 1 MiB aggregate limit per task. Responses expose stable error codes and correlation IDs instead of raw exceptions.

## Recovery

The durable status is the source of truth after restart. The V0 worker may claim only `PENDING`; it must reconcile an existing `RUNNING` task before doing more privileged work. Unknown completion state must not be retried implicitly.
