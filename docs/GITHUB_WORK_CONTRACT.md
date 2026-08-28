# GitHub-Backed Work Contract v1

This is the versioned, machine-readable contract for post-V0 GitHub-first
orchestration. It is consumed through the GitHub App REST API. It does not
require an ADE CLI call, an ADE server, or an MCP endpoint.

The control plane treats all GitHub data as untrusted. It reads only the fields
defined below, validates them exactly, and never infers ordering or state from
an issue title, prose, labels, comments, or a branch name.

## Repository profile

A compatible repository contains this file:

```text
.ade/control-plane.json
```

```json
{
  "version": "ade.github-work-profile/v1",
  "capabilities": ["github-work-items", "human-decisions"],
  "skillPaths": [".agents/skills"]
}
```

The profile is detected with GitHub Contents API using the repository-scoped
GitHub App token. No repository code or ADE CLI is executed for detection.

`github-work-items` is required. `skillPaths` is a bounded set of repository-
relative paths that the later code-agent launch may supply as ADE skills. It is
not executed by the control plane.

## Issue metadata

An issue enters the normalized queue only when its body contains exactly one
single-line marker. Human-readable issue content may appear before or after it.

```html
<!-- ade.github-work/v1 {"state":"ready","priority":80,"dependsOn":[17,23],"retryPolicy":"reconcile-first","humanDecisionRef":null,"executionRef":null,"branchName":null,"pullRequestNumber":null} -->
```

The JSON object has exactly these fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `state` | enum | `ready`, `running`, `waiting-human`, `blocked`, `completed`, `failed` |
| `priority` | integer 0–100 | explicit scheduler priority |
| `dependsOn` | unique issue numbers | explicit dependencies; never inferred from text or labels |
| `retryPolicy` | enum | `safe`, `reconcile-first`, `never` |
| `humanDecisionRef` | opaque string or `null` | corresponding human decision |
| `executionRef` | opaque string or `null` | durable control-plane execution/lease correlation |
| `branchName` | safe Git ref or `null` | resulting work branch |
| `pullRequestNumber` | positive integer or `null` | associated GitHub PR |

Unknown fields, duplicate markers, malformed values, self-dependencies,
non-HTTPS issue links and oversized bodies are rejected from the normalized
queue. Missing/invalid metadata makes an issue ineligible rather than guessing
at a default state.

## Normalized snapshot

The adapter produces `GithubWorkItem` with the validated fields above plus:

- repository numeric ID/owner/name;
- issue number and HTTPS URL;
- GitHub `updated_at` as `sourceUpdatedAt`;
- control-plane `observedAt` and a bounded `expiresAt` freshness deadline.

The scheduler consumes this normalized snapshot only. It may use `state`,
`priority`, dependencies and the retry policy; it does not reread issue text.

## Reconciliation and delivery handling

Periodic reconciliation calls `listWorkItems`. A validated `issues` webhook
for one registered repository calls `getWorkItem` for the exact issue number.
Both paths use the same strict normalizer, so a missed or duplicate delivery
converges to the same snapshot. Webhook delivery ID deduplication remains the
transport-level protection; no webhook launches a code agent or privileged
process directly.

## Agent handoff

After the scheduler has created a durable lease, the future worker launch gets
the exact repository, issue number/URL, validated metadata, configured skill
paths, workspace and expected validations. The agent may use its native Git,
file and terminal tools, but no issue field becomes a shell command.

Branch, PR, checks and a human decision remain correlated through the durable
execution reference and the validated metadata. No auto-merge is implied by
this contract.

## GitHub App permissions

The read path needs repository metadata, Contents read and Issues read. The
existing command/comment flow additionally needs Issues write. Pull requests
remain read-only unless a specific project-scoped notification needs a write.
The GitHub App credential is never supplied to the runner as its Git credential.
