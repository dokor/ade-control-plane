import { strict as assert } from "node:assert";
import test from "node:test";

import {
  DeterministicFakeGithubClient,
  GITHUB_WORK_PROFILE_PATH,
  GITHUB_WORK_PROFILE_VERSION,
} from "@ade-control-plane/github";

import { inspectProjectSetup } from "../src/lib/projectSetup.js";
import type { GithubRuntime } from "../src/lib/githubRuntime.js";

const project = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "alpha",
  name: "Alpha",
  repositoryOwner: "dokor",
  repositoryName: "alpha",
  repositoryId: "123",
  state: "enabled" as const,
  priority: 50,
  adeAdapter: "github-work",
  runnerPolicy: {},
  configuration: {},
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
};

function runtime(client: DeterministicFakeGithubClient): GithubRuntime {
  const setupClient = client as unknown as {
    contents: Map<string, unknown>;
    directories?: Set<string>;
    getRepositoryPathType?: (_repository: unknown, path: string) => Promise<"file" | "directory" | null>;
  };
  setupClient.directories ??= new Set<string>();
  setupClient.getRepositoryPathType ??= async (_repository, path) =>
    setupClient.contents.has(path) ? "file" : setupClient.directories?.has(path) ? "directory" : null;
  return {
    webhookSecret: null,
    policy: { allowedActorIds: [], allowedInstallationIds: [] },
    dashboardUrl: "https://control.example",
    quotaProvider: "openai",
    quotaAccountRef: "main",
    client,
    workReader: undefined,
    issueReader: undefined,
  };
}

function readyClient(): DeterministicFakeGithubClient {
  const client = new DeterministicFakeGithubClient();
  client.defaultBranchHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  client.contents.set(GITHUB_WORK_PROFILE_PATH, {
    path: GITHUB_WORK_PROFILE_PATH,
    sha: "profile",
    content: Buffer.from(JSON.stringify({
      version: GITHUB_WORK_PROFILE_VERSION,
      capabilities: ["github-work-items"],
      skillPaths: [".agents/skills"],
    })).toString("base64"),
  });
  client.contents.set("AGENTS.md", {
    path: "AGENTS.md",
    sha: "agents",
    content: Buffer.from("# Instructions").toString("base64"),
  });
  const setupClient = client as unknown as { directories?: Set<string> };
  setupClient.directories ??= new Set<string>();
  setupClient.directories.add(".agents/skills");
  client.labels.push(
    { name: "ready-for-dev" },
    { name: "waiting-human" },
    { name: "blocked" },
  );
  return client;
}

function compatibility(overrides: Record<string, unknown> = {}) {
  return {
    projectId: project.id,
    repositoryGithubId: "123",
    compatible: true,
    contractVersion: GITHUB_WORK_PROFILE_VERSION,
    capabilities: ["github-work-items"],
    skillPaths: [".agents/skills"],
    reason: "compatible",
    observedAt: "2026-09-07T16:00:00.000Z",
    adeStatus: "compatible",
    adeRuntimeVersion: "0.11.0",
    adeConfigVersion: "ade.project-setup/v1",
    resolvedProfiles: ["normal"],
    resolvedRules: [],
    contextStatus: "fresh",
    missingRequiredCapabilityIds: [],
    runnerCheckoutRef: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ...overrides,
  } as never;
}

test("keeps ADE initialization valid when only the repository revision changes", async () => {
  const readiness = await inspectProjectSetup(
    project,
    runtime(readyClient()),
    undefined,
    compatibility(),
    "0.11.0",
  );

  assert.equal(readiness.ready, true);
  assert.equal(readiness.capabilitySnapshot?.status, "fresh");
  assert.equal(readiness.requirements.find(({ key }) => key === "runner-capability-check")?.state, "ready");
  assert.match(
    readiness.requirements.find(({ key }) => key === "runner-capability-check")?.detail ?? "",
    /versions remain unchanged/,
  );
});

test("requires ADE revalidation when the runtime version changes", async () => {
  const readiness = await inspectProjectSetup(
    project,
    runtime(readyClient()),
    undefined,
    compatibility(),
    "0.12.0",
  );

  assert.equal(readiness.ready, false);
  assert.equal(readiness.capabilitySnapshot?.status, "stale");
  assert.match(
    readiness.requirements.find(({ key }) => key === "runner-capability-check")?.detail ?? "",
    /expects 0\.12\.0/,
  );
});

test("requires ADE revalidation when the contract version changes", async () => {
  const readiness = await inspectProjectSetup(
    project,
    runtime(readyClient()),
    undefined,
    compatibility({ contractVersion: "ade.github-work/v0" }),
    "0.11.0",
  );

  assert.equal(readiness.ready, false);
  assert.equal(readiness.capabilitySnapshot?.status, "stale");
  assert.match(
    readiness.requirements.find(({ key }) => key === "runner-capability-check")?.detail ?? "",
    /contract/,
  );
});

test("keeps an incompatible runner validation blocking", async () => {
  const readiness = await inspectProjectSetup(
    project,
    runtime(readyClient()),
    undefined,
    compatibility({ compatible: false, adeStatus: "incompatible" }),
    "0.11.0",
  );

  assert.equal(readiness.ready, false);
  assert.equal(readiness.capabilitySnapshot?.status, "incompatible");
  assert.equal(readiness.requirements.find(({ key }) => key === "runner-capability-check")?.state, "invalid");
});
