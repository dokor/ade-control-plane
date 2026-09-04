# MVP release-gate scenario ledger

Issue #153 is a production qualification gate. The repository can provide the
black-box happy-path command and the evidence validator, but it cannot create
Raspberry, GitHub App or operator evidence in CI. The scenarios below must be
run against the deployed Dashboard, worker, pinned ADE runtime and a dedicated
low-risk GitHub repository.

## Gate order

Run the gate in this order:

1. deploy the exact SHA and record the ADE/runtime/config/profile versions;
2. run `deploy/bin/qualify-h24 --require-backup` on the Raspberry;
3. prepare a fresh scenario issue/repository fixture and an empty evidence
   ledger from `release-gate-evidence.template.json`;
4. run the scenarios in dependency order, retaining only sanitized evidence
   references in the ledger;
5. run `deploy/bin/validate-release-gate` against the completed ledger;
6. attach the validator output, the sanitized H24 report and the release
   report to the operator sign-off.

The validator is a completeness check. A `passed` status is an operator claim
backed by evidence; it is never inferred from a unit fake or from the happy
path alone.

## Scenario catalog

Every scenario needs a fresh execution correlation, the deployed SHA, the
runtime/config/profile versions, the relevant source issue revision, durable
stage transitions, and a short operator observation. Record IDs, timestamps,
URLs, SHAs and bounded status summaries only. Never copy issue bodies, prompts,
source, full logs, environment dumps or credentials into the ledger.

| ID | Scenario | Action on the deployed system | Required result and evidence |
| --- | --- | --- | --- |
| S01 | Trivial documentation issue | Admit a harmless documentation issue through the real Dashboard and let the worker run it. | One execution reaches the human-review boundary, one `ade/issue-<number>` branch and one PR correlate to the same issue. |
| S02 | Normal code issue with tests | Admit a small code change whose tests are deterministic and safe on the target repository. | ADE validations pass, the PR contains the expected bounded change, and Dashboard/GitHub agree on the branch, head and PR. |
| S03 | Security-sensitive profiles | Admit an issue whose classification requires additional ADE profiles. | The selected profiles are visible in sanitized stage evidence, the extra checks run, and no profile credential/config secret is exposed. |
| S04 | Human decision and resume | Use an ambiguous issue that reaches an actionable ADE decision; resolve it from Dashboard and wait for the same workflow to resume. | The decision reference/options/resolver are recorded, no new provider conversation is started manually, and the original execution correlation continues. |
| S05 | Blocking review correction | Cause a deterministic blocking review finding in the dedicated fixture, then allow the ADE-defined bounded correction path. | The finding, correction attempt and follow-up review are distinct durable events; unbounded retries are refused. |
| S06 | No-change and validation failure | Run one no-change fixture and one fixture with a deterministic validation failure. | Each run has the correct non-success classification, actionable remediation and no PR falsely reported as successful. |
| S07 | Explicit cancellation | Cancel during a provider/ADE stage using the Dashboard control. | Only the correlated execution is cancelled, the process stops, terminal state is durable, and no unexpected branch/PR side effect appears. |
| S08 | Timeout or lost acknowledgement | Use the controlled timeout/lost-ack fixture or interrupt the acknowledgement path. | The execution enters the documented timeout/reconciliation state, never blindly retries, and exposes the operator remediation. |
| S09 | Worker restart checkpoints | Restart the worker after enrichment, provider completion, push and PR creation (separate runs or controlled checkpoints). | Recovery is idempotent: no duplicate provider run, branch or PR; the durable workflow and external GitHub state converge. |
| S10 | Duplicate/missed webhook | Replay one signed delivery and temporarily withhold another, then run the documented reconciliation path. | Duplicate delivery has one logical effect; missed delivery is recovered by reconciliation; webhook IDs and resulting state are correlated. |
| S11 | Closed PR without merge | Close a correlated PR without merging it, then trigger the supported recovery path. | The workflow is not marked completed, the mismatch/blocker is actionable, and recovery does not create a duplicate PR or unsafe retry. |
| S12 | Human merge and dependency | Merge a qualifying PR manually and include a dependent test issue in the fixture. | The same workflow reaches `completed`, the merged head is verified, and the dependent item is unblocked exactly once. |
| S13 | Quota blocked/reset | Force the configured quota fixture into blocked, then reset it through the supported operator action. | New work is blocked while quota is blocked/unknown, the reset is recorded, and work resumes only after a fresh acceptable snapshot. |
| S14 | Raspberry restart/soak | Restart the Compose topology and perform the documented soak window with no manual database edits. | Services return, history remains available, non-terminal work reconciles before new privileged dispatch, and no duplicate external side effect occurs. |

## Evidence contract

Use `docs/release-gate-evidence.template.json` as the starting point. Each
scenario entry must contain:

- `status`: `passed`, `failed`, `blocked` or `not-run`;
- `executedAt`: UTC timestamp when the scenario was completed, or `null` when
  it was not run;
- `evidence`: one or more references to sanitized reports, event IDs, PR URLs,
  commit SHAs or operator records; and
- `notes`: a bounded, actionable summary that contains no raw payload.

The environment section records the deployed SHA, runtime version, Dashboard
URL and test repository identity. The top-level verdict is `passed` only when
all 14 scenarios are `passed`. A failed or blocked scenario must remain
visible; do not replace it with a successful rerun under the same correlation.

## Release decision

The MVP gate is ready only if:

- all 14 scenarios are `passed` against the real deployed topology;
- the happy path required one initial Run action plus explicit human merge;
- no duplicate provider runs, branches or PRs were observed;
- Dashboard, ADE and GitHub show the same lifecycle;
- every failure is classified as safe, reconcile-first or never-retry; and
- the sanitized H24 qualification, evidence ledger and release report are
  attached to the sign-off.

If any prerequisite or scenario is missing, leave the verdict `not-ready` or
`blocked` and link the follow-up issue. Do not close #153 from repository tests
alone.
