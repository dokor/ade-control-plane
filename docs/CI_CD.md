# CI/CD: hosted ARM64 builds and immutable deployment (#218)

## Pipeline and trust boundary

CI runs operational/security checks, typecheck, tests (with PostgreSQL), and the
affected Dashboard build/smoke test concurrently. The final `validate` job remains
the branch-protection gate and fails if any required check fails or is cancelled.
Dependency installation uses the committed lockfile and setup-node's pnpm store
cache. Full tests/typecheck remain mandatory; runtime build filtering does not
replace release validation.

Only a successful same-repository **main push** CI run may enter production image
preparation. PR code never runs on the production runner or receives package-write
permissions. Both images use native `ubuntu-24.04-arm` GitHub-hosted runners, not
QEMU, with separate persistent BuildKit GHA caches. Dashboard and worker jobs run
in parallel. OS, ADE and Codex install layers precede application copies, so source
changes do not reinstall tools or require downloading those layers on Raspberry.

The shared `deploy/bin/deployment-scope` classifies runtime inputs conservatively.
ADE client, host-runner and runner-protocol are worker-only. Core/database/GitHub/
quota and unknown/infrastructure inputs affect both runtimes. Documentation-only
commits skip image preparation and production execution entirely.

Before each image build, a SHA-256 key of the committed Git objects affecting that
runtime is checked against GHCR. If an image for those exact inputs exists, no
Docker build or layer transfer is needed. This also safely handles skipped/coalesced
releases: a changed worker from an earlier commit is not silently replaced by an
old deployed worker when the latest commit only touches Dashboard. Cache lookup
uses small manifest requests; an ARM job still starts to perform that lookup.

New artifacts have both `sha-<validated-commit>` and `source-<input-key>` tags, plus
source/revision/input-key labels. Unchanged runtime inputs can reuse an earlier
validated artifact. Deployment always receives **repository@sha256:digest**, never
`latest` or a mutable tag. The wrapper verifies the image input-key label against
the requested revision before migrations or application switching. This records
the exact CI artifact rather than rebuilding source on production.

## One-time cutover — required before enabling normal deployment

The existing root-owned `/usr/local/sbin/ade-control-plane-deploy` is an installed
copy. Merging this PR does **not** update it. Do not grant the Actions account
generic sudo or teach a root script to replace itself from untrusted PR content.

1. An authorized host administrator reviews and installs the new `deploy/bin/deploy`
   at that existing root-owned path (mode 0755), preserving the narrowly scoped
   sudoers rule. This requires administrative host access once; Dashboard access
   alone is insufficient. The old one-argument invocation is no longer accepted.
2. Ensure the host can pull both GHCR packages. Prefer public visibility for these
   public-source images if appropriate; alternatively provision a **read:packages**
   credential in the root Docker credential store. Do not use the App private key,
   write credentials or agent mounts for registry pulls. Package visibility/host
   credentials are operator actions, not automatically changed by this PR.
3. Confirm the two hosted ARM64 builds and published digests, then set repository
   variable `ADE_PREBUILT_DEPLOY_READY=true`. Until then, deployment fails explicitly
   with an installation reminder; it does not fall back to a Raspberry build.
4. Rerun the validated release. Pull only affected services, check image identity,
   migrate only for migration-sensitive changes (or unknown/initial baseline),
   switch with `--no-build --no-deps`, and keep the PostgreSQL/application health
   checks. The unchanged runtime is not recreated. Releases remain serialized.

Workers retain their existing startup migration check; the explicit deployment
migration command is scope-gated. No database, worker network or container security
boundary is relaxed. No production bootstrap or permission change was performed
while preparing this PR.

## Manual outage fallback and rollback

Normal CI never invokes the fallback. If Actions/GHCR is unavailable, an authorized
operator can invoke the reviewed installed wrapper manually:

```sh
sudo /usr/local/sbin/ade-control-plane-deploy <reviewed-40-character-sha> --local
```

This builds only affected services locally, retains migration/health checks, and
records the release. Git/npm/tool downloads still require network unless cached;
this is not a promise of an offline rebuild. If GitHub itself is unavailable, an
already staged revision and a separately reviewed offline procedure are needed;
the wrapper deliberately still validates/fetches the requested Git object.

For a normal rollback, use a retained validated SHA and its two recorded immutable
digests followed by `--rollback`. Without this explicit flag, normal releases
cannot move backwards or diverge from the recorded production revision, including
when an older CI run finishes late. Pre-cutover revisions require the explicit
local mode because they have no image input-key contract. Review schema rollback
compatibility first: application rollback does not undo migrations automatically.

## GHCR retention — manual, fail closed

The wrapper records actual running repository digests per service and release in
`/var/lib/ade-control-plane/image-history.tsv` after health checks. Actions build
summaries also retain emitted digests. Before any package-version cleanup:

1. Export/reconcile this history with the currently running images. If the current
   production digests are unknown or disagree, **do not delete anything**.
2. Protect the current digest for each runtime, **at least the previous five
   successful production releases**, and every explicitly versioned/released
   artifact (including `v*`/`release-*` tags). Protect their ARM64 child manifests
   and provenance artifacts too; an untagged version is not necessarily unused.
3. Produce a dry-run candidate list of unprotected versions older than 30 days.
   Review it against deployment/build history before deleting GHCR package versions.
   Protect both SHA and source-key references to retained artifacts. Age alone is
   never sufficient. A removed source-key cache entry only causes a later rebuild.
4. Keep the cleanup credential separate from production pull credentials. Cleanup
   requires explicit maintainer approval and is **not** a scheduled destructive job
   in this PR. Never prune local Docker images as a substitute for this inventory.

Cache hits intentionally reuse the already-built tool/base layers. To ship base or
tool security updates, change the reviewed Dockerfile/version inputs; do not expect
an unchanged source-key cache hit to refresh floating upstream artifacts.

## Measurement: baseline recorded; post-cutover result pending

Recent successful deployment workflow elapsed times (creation → completion,
including queueing, not CI-before-deploy) on 2026-09-04:

| Run | Elapsed |
| --- | --- |
| [33885484177](https://github.com/dokor/ade-control-plane/actions/runs/33885484177) | 14m 11s |
| [33882293631](https://github.com/dokor/ade-control-plane/actions/runs/33882293631) | 12m 39s |
| [33877283671](https://github.com/dokor/ade-control-plane/actions/runs/33877283671) | 18m 58s |

After administrator cutover, record at least three warm-cache dashboard-only and
three worker-only releases, plus one cold-cache and one docs-only control. For
each keep merge/CI/build/pull/healthy timestamps, source SHA, digests, cache hits,
downloaded layer bytes and changed service names. Report median merge-to-healthy
and deploy-only time separately. The **2–5 minute target is not yet measured or
claimed achieved**; cold builds, registry transfer and runner queueing still count.
Keep #218's performance acceptance open until this evidence exists.

References: [native ARM64 hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
[BuildKit GHA cache](https://docs.docker.com/build/cache/backends/gha/).
