# GitHub App Setup

## Purpose

Prepare the GitHub-side configuration required by issue #8 without granting broader permissions than the control plane needs.

The control-plane GitHub App is for project interaction, webhooks, comments and PR creation where explicitly required. It is not a generic repository administrator credential.

## Recommended model

Install one GitHub App only on repositories managed by ADE Control Plane.

Use:

- repository-scoped installation;
- short-lived installation tokens;
- signed webhooks;
- explicit allow-list of authorized human actor IDs;
- separate Git credentials for host development operations when practical.

## Required metadata to record outside secrets

- GitHub App ID;
- installation ID(s);
- repository numeric IDs;
- authorized human GitHub user numeric IDs;
- webhook public URL;
- expected Dashboard base URL.

Do not use login names alone as durable authorization identities because users can rename them.

## Repository permissions target

Start with the minimum and only widen after a failing required operation proves a need.

### Metadata

- Read-only.

### Issues

- Read/write when `@ade` commands and bot comments are issue-based.

### Pull requests

- Read/write when the control plane creates PRs or comments on PRs.

### Contents

- Prefer read-only or none for the control-plane GitHub App.
- If PR creation is performed through Git push + REST PR creation, repository write access for Git should remain a separate runner/deploy credential rather than silently widening the App.

### Actions / Administration / Secrets / Deployments

- None by default.

Any future permission increase must be documented with the exact API operation that requires it.

## Webhook subscriptions

Subscribe only to events used by the implementation:

- `issue_comment`;
- `issues` only if needed for state/reference synchronization;
- `pull_request`;
- `pull_request_review` only when review decisions become part of the ADE contract.

Do not subscribe broadly “for later”.

## Secrets

Expected runtime secrets:

```text
GITHUB_APP_PRIVATE_KEY_FILE
GITHUB_WEBHOOK_SECRET_FILE
```

The private key and webhook secret:

- live outside the repository;
- are readable only by the component that needs them;
- are not made available to Codex/model context;
- are not reused as Git push credentials;
- can be rotated independently.

## Actor authorization

For the first trusted-user deployment, configure an explicit allow-list:

```text
GITHUB_ALLOWED_ACTOR_IDS=<numeric user IDs>
GITHUB_ALLOWED_INSTALLATION_IDS=<installation IDs>
```

Policy:

- bots are refused;
- unknown actors may read nothing about control-plane management beyond normal GitHub repository visibility;
- mutating commands require the stricter allow-list;
- authorization is checked after signature verification and repository mapping.

## Webhook URL

Expected shape:

```text
https://<dashboard-host>/api/github/webhook
```

Requirements:

- HTTPS through the existing reverse proxy;
- raw request body preserved for signature verification;
- no Dashboard session required on this route;
- webhook secret verification mandatory;
- body size limit enforced;
- no privileged execution in the HTTP request lifecycle.

## Initial setup checklist

1. Create GitHub App.
2. Configure minimal repository permissions.
3. Configure only required webhook events.
4. Generate private key.
5. Generate strong webhook secret.
6. Install App on one low-risk test repository first.
7. Record App/installation/repository numeric IDs.
8. Add runtime secrets on Raspberry.
9. Add authorized actor IDs.
10. Verify unsigned webhook is rejected.
11. Verify valid signed `@ade status` works.
12. Verify unauthorized actor command is refused without leaking management details.
13. Verify duplicate delivery has no duplicate effect.
14. Expand installation to other ADE-managed repositories only after the test repository passes.

## Human decision flow to validate later

```text
ADE waiting-human
→ control plane posts/updates targeted GitHub comment
→ authorized human sends @ade decide ...
→ signed webhook
→ typed durable ControlCommand
→ worker forwards decision to ADE
→ scheduler wakes
→ project may become runnable again
```

The outbound first step is still a remaining implementation item of #8; this document does not claim it is already wired.
