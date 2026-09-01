import { strict as assert } from "node:assert";
import test from "node:test";

import { DeterministicFakeGithubClient } from "@ade-control-plane/github";

import { buildProjectOnboardingPlan, deriveProjectSlug, normalizeGithubRepositoryUrl } from "../src/lib/projectOnboarding.js";
import type { GithubRuntime } from "../src/lib/githubRuntime.js";

function runtime(client: DeterministicFakeGithubClient): GithubRuntime {
  return { webhookSecret: null, policy: { allowedActorIds: [], allowedInstallationIds: [] }, dashboardUrl: "https://control.example", quotaProvider: "openai", quotaAccountRef: "main", client, workReader: undefined, issueReader: undefined };
}

test("normalizes only HTTPS GitHub repository URLs", () => {
  assert.deepEqual(normalizeGithubRepositoryUrl("https://github.com/dokor/ade-control-plane/"), { owner: "dokor", name: "ade-control-plane", url: "https://github.com/dokor/ade-control-plane" });
  assert.throws(() => normalizeGithubRepositoryUrl("git@github.com:dokor/ade-control-plane.git"), /HTTPS GitHub|Only URLs/);
  assert.throws(() => normalizeGithubRepositoryUrl("https://github.com/dokor/ade-control-plane/issues/1"), /Only URLs/);
});

test("builds a disabled onboarding plan after verifying repository access", async () => {
  const client = new DeterministicFakeGithubClient();
  client.repositoryMetadata = { ...client.repositoryMetadata, name: "ade-control-plane", url: "https://github.com/dokor/ade-control-plane" };
  const plan = await buildProjectOnboardingPlan({ repositoryUrl: "https://github.com/dokor/ade-control-plane" }, runtime(client), []);
  assert.equal(plan.repositoryId, "123");
  assert.equal(plan.defaultBranch, "main");
  assert.equal(plan.checkout, "ade-control-plane");
  assert.equal(plan.initialState, "disabled");
  assert.equal(plan.contentsReadable, true);
  assert.equal(plan.adeProfile, "missing");
});

test("refuses duplicate repository registrations", async () => {
  const client = new DeterministicFakeGithubClient();
  await assert.rejects(() => buildProjectOnboardingPlan({ repositoryUrl: "https://github.com/dokor/alpha" }, runtime(client), [{ id: "p1", slug: "alpha", name: "Alpha", repositoryOwner: "dokor", repositoryName: "alpha", repositoryId: "123", state: "disabled", priority: 1, adeAdapter: "github-work", runnerPolicy: {}, configuration: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }]), /already registered/);
});

test("derives a safe stable slug", () => {
  assert.equal(deriveProjectSlug("My_New.Project"), "my-new-project");
});
