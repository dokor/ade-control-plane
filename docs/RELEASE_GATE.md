# Functional MVP release gate (#153)

The functional MVP gate is **imported ADE project → ordinary issue → ADE-managed PR → human merge/completed**, with minimal Dashboard and AI usage/quota visibility. It does not require the separate #88 H24/48h+ soak.

Code/CI cannot prove production credentials, a fresh Raspberry clone, human decisions or merge. Keep #153 open until real evidence and operator sign-off exist. #185 verifies fresh secure provisioning; #189 verifies imported-project onboarding and first delivery.

## No Raspberry terminal required

Use GitHub Actions to verify deployment and the authenticated Dashboard to register/prepare a project, start initialization, Run the issue and inspect progress. Use GitHub for explicit human review/merge. Never delete a checkout merely to manufacture a fresh-clone claim. If the repository already has a checkout or prepared ADE state, record that limitation and qualify the missing steps separately.

The optional `deploy/bin/qualify-github-work` black-box harness can run on an operator workstation with Bash, curl, jq and authenticated gh; it talks to Dashboard/GitHub and does not require Raspberry shell access. It expects an already registered ADE-ready project: its success alone cannot prove onboarding. Set `ADE_RELEASE_GATE_WAIT_FOR_MERGE=true` to observe final completion; it never performs the merge. Credentials must remain in protected runtime input, never a report or committed file.

## Functional evidence

Start with [functional-mvp-evidence.template.json](functional-mvp-evidence.template.json). Record only safe IDs, timestamps, SHAs, URLs and bounded observations. No prompts, issue bodies, raw provider logs, chain-of-thought, credentials or session cookies.

| ID | Required real evidence |
| --- | --- |
| F01 | #185: exact deployed SHA, no pre-existing checkout, strict Git preflight/clone success and authorized identity; no private key material |
| F02 | #189: project import/registration and actual missing setup proposed through a reviewable PR; explicit merge when required |
| F03 | Real runner capability/readiness proof at the expected default-branch SHA, ADE runtime/config/profiles/skills/rules |
| F04 | One ordinary open issue admitted with one initial Run; source revision and ADE refinement/enrichment when needed |
| F05 | ADE-owned plan/handoff and provider identity; implementation, deterministic validations and ADE reviews |
| F06 | At least one bounded correction OR human-decision path; if a decision is triggered, its safe ref/options/resolution resume the same durable workflow |
| F07 | Exactly one correlated branch/head/PR, no duplicate provider runs or publication side effects |
| F08 | Explicit human merge followed by the same workflow reaching completed |
| F09 | Dashboard readiness/stages/blockers, issue/PR correlation and relevant AI usage/quota/dispatch observations |

Every passed entry needs an execution timestamp and references to real evidence. Record scope limitations honestly: a pre-existing repository configuration cannot be labeled a newly generated setup PR. Keep failed attempts under their original correlation; a successful rerun is a new run.

Validate on any workstation with Node.js 22+:

```bash
node deploy/bin/validate-functional-mvp.mjs /path/to/evidence.json
```

The strict schema v2 validator rejects incomplete/blocked entries, missing evidence, unknown/raw fields and credential-shaped content. A structural pass checks operator claims, not the authenticity of remote evidence. Human sign-off must verify the references. The checked-in template intentionally fails.

## Operational qualification stays separate

The historical S01–S14 catalog and schema v1 validator remain available for broader operational qualification: [RELEASE_SCENARIOS.md](RELEASE_SCENARIOS.md), [release-gate-evidence.template.json](release-gate-evidence.template.json), `deploy/bin/validate-release-gate`, and `deploy/bin/qualify-h24 --require-backup`.

Those checks cover cancellation, failures, restart/recovery, duplicate webhooks, quotas, backups and soak. They are not silently waived or marked passed by functional success. #88/#9/#10 track the separate operational/topology/hardening work; mandatory security controls still apply to all functional runs.
