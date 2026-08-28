import assert from "node:assert/strict";
import test from "node:test";

import {
  GITHUB_WORK_PROFILE_VERSION,
  HttpGithubWorkAdapter,
  isGithubWorkItemFresh,
  normalizeGithubWorkItem,
  type GithubWorkRepositoryProfile,
} from "../src/workAdapter.js";

const repository = { id: "123", owner: "dokor", name: "alpha" };
const observedAt = new Date("2026-08-28T10:00:00.000Z");

function profile(overrides: Partial<GithubWorkRepositoryProfile> = {}): GithubWorkRepositoryProfile {
  return {
    repository,
    compatible: true,
    contractVersion: GITHUB_WORK_PROFILE_VERSION,
    capabilities: ["github-work-items", "human-decisions"],
    skillPaths: [".agents/skills"],
    observedAt: observedAt.toISOString(),
    reason: "compatible",
    ...overrides,
  };
}

function issue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 42,
    html_url: "https://github.com/dokor/alpha/issues/42",
    updated_at: "2026-08-28T09:59:00.000Z",
    body: [
      "Human context can stay outside the machine contract.",
      "<!-- ade.github-work/v1 {\"state\":\"ready\",\"priority\":80,\"dependsOn\":[7],\"retryPolicy\":\"reconcile-first\",\"humanDecisionRef\":null,\"executionRef\":null,\"branchName\":null,\"pullRequestNumber\":null} -->",
    ].join("\n"),
    ...overrides,
  };
}

function profileContent(capabilities: readonly string[] = ["github-work-items"]): Response {
  return Response.json({
    type: "file",
    encoding: "base64",
    content: Buffer.from(JSON.stringify({
      version: GITHUB_WORK_PROFILE_VERSION,
      capabilities,
      skillPaths: [".agents/skills"],
    })).toString("base64"),
  });
}

test("normalizes only the strict versioned issue metadata", () => {
  const item = normalizeGithubWorkItem(issue(), profile(), observedAt);

  assert.deepEqual(item, {
    contractVersion: "ade.github-work/v1",
    repository,
    issueNumber: 42,
    issueUrl: "https://github.com/dokor/alpha/issues/42",
    state: "ready",
    priority: 80,
    dependsOn: [7],
    retryPolicy: "reconcile-first",
    humanDecisionRef: null,
    executionRef: null,
    branchName: null,
    pullRequestNumber: null,
    sourceUpdatedAt: "2026-08-28T09:59:00.000Z",
    observedAt: "2026-08-28T10:00:00.000Z",
    expiresAt: "2026-08-28T10:05:00.000Z",
  });
});

test("makes GitHub work freshness explicit", () => {
  const item = normalizeGithubWorkItem(issue(), profile(), observedAt);
  assert.ok(item);
  assert.equal(isGithubWorkItemFresh(item, "2026-08-28T10:04:59.000Z"), true);
  assert.equal(isGithubWorkItemFresh(item, "2026-08-28T10:05:00.000Z"), false);
});

test("refuses free text, duplicate markers, unsupported fields and self-dependencies", () => {
  assert.equal(normalizeGithubWorkItem(issue({ body: "ready high priority" }), profile(), observedAt), null);
  assert.equal(
    normalizeGithubWorkItem(issue({ body: `${issue().body}\n<!-- ade.github-work/v1 {} -->` }), profile(), observedAt),
    null,
  );
  assert.equal(
    normalizeGithubWorkItem(issue({
      body: "<!-- ade.github-work/v1 {\"state\":\"ready\",\"priority\":80,\"dependsOn\":[42],\"retryPolicy\":\"safe\",\"humanDecisionRef\":null,\"executionRef\":null,\"branchName\":null,\"pullRequestNumber\":null} -->",
    }), profile(), observedAt),
    null,
  );
  assert.equal(
    normalizeGithubWorkItem(issue({
      body: "<!-- ade.github-work/v1 {\"state\":\"ready\",\"priority\":80,\"dependsOn\":[],\"retryPolicy\":\"safe\",\"humanDecisionRef\":null,\"executionRef\":null,\"branchName\":null,\"pullRequestNumber\":null,\"untrusted\":true} -->",
    }), profile(), observedAt),
    null,
  );
});

test("detects a compatible repository and reconciles only valid GitHub work items", async () => {
  const requests: string[] = [];
  const adapter = new HttpGithubWorkAdapter({
    installationId: "installation-1",
    tokens: { getToken: async () => "short-lived-token" },
    now: () => observedAt,
    fetchImplementation: async (url, init) => {
      requests.push(String(url));
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer short-lived-token");
      if (String(url).endsWith("/.ade/control-plane.json")) return profileContent();
      return Response.json([
        issue(),
        issue({ number: 43, pull_request: { url: "https://api.github.com" } }),
        issue({ number: 44, body: "ordinary issue text" }),
      ]);
    },
  });

  const detected = await adapter.detectRepository(repository);
  const items = await adapter.listWorkItems(repository);

  assert.equal(detected.compatible, true);
  assert.deepEqual(detected.skillPaths, [".agents/skills"]);
  assert.deepEqual(items.map(({ issueNumber }) => issueNumber), [42]);
  assert.ok(requests.some((url) => url.includes("/contents/.ade/control-plane.json")));
  assert.ok(requests.some((url) => url.includes("/issues?state=all&per_page=100")));
});

test("treats a missing or invalid profile as incompatible without executing project code", async () => {
  const missing = new HttpGithubWorkAdapter({
    installationId: "installation-1",
    tokens: { getToken: async () => "token" },
    fetchImplementation: async () => new Response(null, { status: 404 }),
    now: () => observedAt,
  });
  const invalid = new HttpGithubWorkAdapter({
    installationId: "installation-1",
    tokens: { getToken: async () => "token" },
    fetchImplementation: async () => profileContent([]),
    now: () => observedAt,
  });

  assert.equal((await missing.detectRepository(repository)).reason, "missing-profile");
  assert.equal((await invalid.detectRepository(repository)).reason, "unsupported-profile");
});

test("uses the same strict normalizer for one-issue webhook refreshes", async () => {
  const adapter = new HttpGithubWorkAdapter({
    installationId: "installation-1",
    tokens: { getToken: async () => "token" },
    now: () => observedAt,
    fetchImplementation: async (url) => String(url).endsWith("/.ade/control-plane.json")
      ? profileContent()
      : Response.json(issue()),
  });

  const item = await adapter.getWorkItem(repository, 42);
  assert.equal(item?.state, "ready");
  assert.deepEqual(item?.dependsOn, [7]);
});
