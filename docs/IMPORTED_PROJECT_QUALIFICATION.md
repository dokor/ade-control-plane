# Imported project → first ADE delivery qualification

This is the operator procedure for [#189](https://github.com/dokor/ade-control-plane/issues/189),
feeding the functional MVP gate [#153](https://github.com/dokor/ade-control-plane/issues/153).
It is not the H24 soak. Passing unit tests or running an already-prepared checkout
does not establish imported-project onboarding.

## Access and evidence boundary

Use an explicitly authorized repository, authenticated Dashboard and GitHub Actions.
The procedure does not require a Raspberry terminal. Do not delete an existing
project/checkout, remove ADE files or weaken SSH verification to manufacture the
initial conditions. If provenance is unavailable, record it as unverified and ask
the operator for an appropriate repository or retained import evidence.

Record only UTC times, revisions, project/task/workflow IDs, issue/PR/run links,
classified error codes, capability status and non-sensitive usage totals. Never
attach session cookies, credentials, environment dumps or complete raw logs.

## Checkpoints

| Checkpoint | Required observation | Stop condition |
| --- | --- | --- |
| Import provenance | Registration of the authorized repository with no pre-provisioned worker checkout or manually prepared ADE state | Already registered with no historical evidence: onboarding remains unverified |
| Secure provisioning (#185) | Successful exact-revision deployment, fresh preflight/clone and authorized Git identity | SSH/auth/network failure: retain safe reason; no host-key bypass |
| Prepare ADE | Actual file/label inspection; reviewable setup PR when required, preserving existing files | Missing/invalid files or pending PR: do not mark ready |
| Human setup merge | Operator merges setup PR; retain PR URL and merge SHA | No automatic merge; wait for the operator |
| Runner proof | Initialization task and runner capability snapshot tied to refreshed checkout SHA; required profiles/skills/contracts executable | Repository-only checks or unknown/stale runner result are insufficient |
| First issue, one Run | Ordinary issue without manually authored `ade.github-work/v1`; one admitted workflow | No second manual agent task to advance a stage |
| ADE delivery | ADE refinement decision, profile/skill/rule selection, validated handoff, validation/review and bounded corrections | Failure or blocked stage must not become success |
| Human decision, if exercised | Offered decision resolves and the same durable workflow resumes | Do not invent a decision or create a replacement workflow |
| Publication and completion | One correlated branch/PR after gates, human merge, reconciliation to `completed` | PR creation alone is not completion |
| Dashboard evidence | Readiness, stage/blocker, issue/branch/PR, provider/model when known and usage/quota/dispatch visible | Unknown values remain unknown, not zero or inferred success |

An already configured repository legitimately needs no setup PR. Record that fact;
it does not by itself test the missing-files/setup-PR acceptance criterion.

## Bounded ordinary-issue fixture

Only after runner readiness and an available execution slot, create a normal issue
in the authorized repository. A suitable small change is a documentation page
explaining how an operator distinguishes `waiting-human` from `completed` using
the current Dashboard and existing lifecycle documentation. Require accurate
links, no runtime/security/deployment changes and the project's normal checks.
Do not include ADE machine metadata, force a profile, prescribe a delivery graph
or bypass validation. ADE must own those choices.

Select that issue in the Dashboard and press Run once. Keep its issue number,
task/workflow ID and eventual PR URL together in the report. A human correction
can be requested through an existing supported gate if actually needed; do not
fabricate a successful correction stage. Leave both setup and delivery PR merges
to the operator.

## Report format and restart discipline

For each checkpoint record `passed`, `failed`, `blocked` or `not-run`, a timestamp,
correlated references and a short explanation. Distinguish current observations
from historical incidents. Link the completed report to #185/#189/#153; leave
unverified criteria open. If interrupted, inspect the existing task/workflow and
PR before any retry. Never press Run again solely because the page is unchanged.

The first production observation is in
[the 2026-09-04 report](qualification/189-production-2026-09-04.md).
