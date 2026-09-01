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
| `POST` | `/api/tasks` | Create a pending task from `projectId` and either a prompt or a GitHub issue source; return `409` when another task is active. |
| `POST` | `/api/projects/{id}/initialize` | Create and immediately wake a dedicated ADE initialization task for a project whose setup is required. |
| `GET` | `/api/github/issues?projectId={id}` | Return the registered project's open ADE-managed issues whose work contract state is `ready`. |
| `GET` | `/api/tasks/{id}` | Return task detail and up to 2,000 log records. |
| `POST` | `/api/tasks/{id}/cancel` | Persist cancellation intent or cancel a pending task. |

Task prompts are limited to 20,000 characters. Each log message is redacted and limited to 4 KiB, with a durable 1 MiB aggregate limit per task. Responses expose stable error codes and correlation IDs instead of raw exceptions.

## GitHub troubleshooting logs

The BFF emits structured `[dashboard-bff]` request lifecycle logs and the browser
emits matching `[dashboard-frontend]` API lifecycle logs. GitHub issue requests
include a client request ID (`x-dashboard-request-id`) and the BFF correlation ID;
use both IDs to follow a request across the browser and server logs. Entries include
only the endpoint path, status, duration and classified error metadata. Query
strings, request bodies, credentials, issue content and raw GitHub error payloads
are intentionally excluded.

## Dashboard workflow

The authenticated `/tasks` page is the V0 task runway. It lists enabled projects and lets the operator choose an open ADE-managed `ready` GitHub issue, with a focused free-form prompt as a secondary source. Status and history refresh through the Dashboard polling interval; no long-lived browser connection is required.

The task source is persisted as one of:

```json
{ "type": "prompt", "prompt": "..." }
```

or:

```json
{ "type": "github-issue", "issueNumber": 23 }
```

The project initialization action uses a third source:

```json
{ "type": "ade-initialize" }
```

Initialization tasks let Codex create the missing ADE configuration before the ADE
runtime validates the project. The worker then runs the normal context generation,
setup check and delivery gates before creating the human-reviewed pull request.

Issue titles are read-only Dashboard metadata. Issue bodies and comments are not copied into task persistence or returned by the issue API.

Each `/tasks/{id}` detail page shows the durable lifecycle state, branch, safe GitHub pull-request link, sanitized error summary and up to 2,000 sanitized log entries. `PENDING` tasks can be cancelled and `RUNNING` tasks can be stopped from either page. Pull-request links are rendered only when they use HTTPS on `github.com`; external task content is always rendered as text.

## Recovery

The durable status is the source of truth after restart. The V0 worker may claim only `PENDING`; it must reconcile an existing `RUNNING` task before doing more privileged work. Unknown completion state must not be retried implicitly.
