# GitHub Integration

## Purpose

GitHub is the project-scoped human interaction surface for ADE Control Plane.

Use GitHub for:

- project issues and PR context;
- targeted human decisions;
- status/attention notifications tied to a repository object;
- explicit project-level control commands.

Use the Dashboard for global supervision, scheduling priorities, quota views, runner health and broad operational control.

## Preferred integration model

Prefer a **GitHub App** over a broad personal access token when practical.

Benefits:

- repository-scoped installation;
- explicit permissions;
- short-lived installation tokens;
- webhook identity/signature model;
- easier revocation and audit.

If the MVP initially uses a fine-grained PAT, keep the adapter contract compatible with a later GitHub App transition and grant only required repository permissions.

## Repository mapping

Every registered control-plane project maps to exactly one GitHub repository identity.

Recommended durable identifiers:

- GitHub repository numeric ID where available;
- owner/name for display/routing;
- control-plane `project_id` as internal authority.

Do not authorize a command solely because a payload names a repository string.

## Webhook receiver

The Dashboard/control API may expose the GitHub webhook endpoint because it is the public HTTP surface.

Required validation order:

1. enforce request size limit;
2. read raw request body required for signature validation;
3. validate GitHub webhook signature;
4. require delivery ID and event name;
5. deduplicate delivery ID;
6. resolve installation/repository to an allow-listed project;
7. parse only event fields required for routing;
8. persist normalized delivery record;
9. enqueue/record a typed internal command/event;
10. respond quickly; privileged runner work happens asynchronously through worker scheduling.

Never trigger host execution directly inside the public webhook request lifecycle.

## Event scope

Start with the minimum events required by the actual workflow.

Likely candidates:

- `issue_comment`;
- `issues`;
- `pull_request`;
- optionally `pull_request_review` if ADE requires review signals.

Do not subscribe to broad events "just in case".

## Commands

Commands should be explicit and easy to distinguish from arbitrary issue text.

A possible MVP syntax:

```text
@ade status
@ade pause
@ade resume
@ade retry
@ade priority 80
@ade decide <decision-ref> <option>
```

Exact syntax may change, but parsing must produce a typed `ControlCommand`.

GitHub text never becomes a shell command or raw ADE command string.

## Authorization

A valid GitHub webhook signature proves the event came from GitHub; it does **not** prove the human actor is authorized for every control-plane action.

Authorization must consider:

- mapped project/repository;
- GitHub actor ID/login;
- configured authorized identities/roles;
- command type;
- potentially repository permission level fetched or cached through the GitHub integration.

For a single-user MVP, an explicit allow-list of authorized GitHub actor IDs can be safer and simpler than inferring complex repository roles.

Sensitive commands require stricter policy than status reads.

## Command classes

### Read-only

- status;
- explain waiting reason;
- show Dashboard link;
- show latest relevant execution/decision reference.

### Scheduling control

- pause project;
- resume project;
- change priority.

### Recovery

- request retry only when the control plane has classified the failure as safely retryable;
- otherwise return that reconciliation/manual inspection is required.

### Project decision

- resolve a known ADE decision reference with one of the options ADE exposes.

Do not allow GitHub commands to invent arbitrary project decision payloads.

## Notification behavior

Avoid noisy bot activity.

Create/update GitHub messages when human attention is materially useful, such as:

- ADE is waiting for a targeted decision;
- an execution failed and needs intervention;
- a PR is ready for review if ADE/workflow requests it;
- the project is paused due to a project-specific condition requiring attention.

Global provider quota pressure should normally be visible in the Dashboard. Only comment in GitHub when it directly explains why a specific project is waiting and the message adds value.

## Idempotency

Use webhook delivery IDs for transport-level deduplication.

Commands should also derive an idempotency key from stable event/comment identity plus parsed command where appropriate.

Repeated delivery must not:

- apply priority change twice in an unsafe way;
- create duplicate execution attempts;
- resolve one human decision multiple times;
- generate repeated comments unnecessarily.

## Comment/update strategy

Prefer updating an existing bot status comment when repeated state changes relate to the same interaction, rather than appending unlimited comments.

Persist enough mapping metadata to find the bot-authored comment safely.

Never overwrite human-authored content.

## Untrusted content

Treat as untrusted:

- issue titles/bodies;
- comments;
- PR descriptions;
- code/diffs;
- labels supplied by repository users;
- linked external content.

GitHub content may become ADE context only through ADE's own context/security rules. The control plane should not copy arbitrary GitHub text into privileged runner commands.

## Permissions target

Final GitHub App permissions depend on implementation, but the MVP should aim for the smallest set such as:

- repository metadata: read;
- issues: read/write if comments/commands are issue-based;
- pull requests: read/write only if PR comments/status interaction requires it;
- contents: avoid write permission unless a concrete control-plane operation requires it;
- administration/actions/secrets: no access by default.

ADE/runner may have separate Git credentials for development work. Do not automatically reuse the control-plane GitHub App credential inside the runner.

## Secrets

GitHub App private key/webhook secret or PAT:

- injected at runtime;
- never committed;
- never sent to runner unless the runner specifically owns a separate Git operation credential;
- never logged;
- independently rotatable.

## Audit events

For each parsed command record:

- GitHub delivery ID;
- repository/project ID;
- actor reference;
- comment/issue/PR reference;
- command type;
- authorization outcome;
- resulting control-plane command ID;
- result.

Do not persist the entire raw payload by default.

## Example flow — human decision

```text
ADE reports waiting-human decision D42
→ worker persists project snapshot/event
→ GitHub adapter posts targeted comment on related issue/PR
→ authorized user comments `@ade decide D42 option-a`
→ signed webhook received
→ delivery deduplicated
→ actor + project + decision authorized
→ ControlCommand persisted
→ worker wakes
→ control plane sends typed ade.apply-decision to runner
→ runner delegates decision to ADE
→ result persisted
→ project becomes runnable again
→ bot updates/acknowledges GitHub interaction
```

At no point does the GitHub webhook handler execute a shell command or bypass ADE decision semantics.