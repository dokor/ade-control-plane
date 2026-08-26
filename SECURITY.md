# Security Policy

ADE Control Plane coordinates privileged development automation. Security issues should be treated as sensitive.

## Reporting a vulnerability

Do not publish exploit details, credentials, private repository data or reproducible attack steps in a public issue.

Prefer GitHub's private security reporting/security-advisory mechanism for this repository when available. If a private reporting channel is not available, contact the repository owner privately rather than posting sensitive details publicly.

For ordinary non-sensitive bugs, use GitHub issues.

## Security architecture

The maintained threat model, trust boundaries and release-blocking controls are documented in [`docs/SECURITY.md`](docs/SECURITY.md).

Key invariants include:

- no generic shell capability exposed by the host runner protocol;
- no Docker socket in Dashboard/worker containers;
- runner and PostgreSQL are not publicly reachable;
- signed/authenticated and replay-protected privileged interactions;
- strict project workspace containment;
- least-privilege, independently rotatable credentials;
- secrets excluded from prompts, logs and audit records;
- ambiguous privileged execution outcome requires reconciliation before retry.

Security issue #10 is release-blocking for the always-on Raspberry deployment.
