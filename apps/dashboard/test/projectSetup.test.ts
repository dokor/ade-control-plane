import { strict as assert } from "node:assert";
import test from "node:test";

import { DeterministicFakeGithubClient, GITHUB_WORK_PROFILE_PATH, GITHUB_WORK_PROFILE_VERSION } from "@ade-control-plane/github";

import { inspectProjectSetup, prepareProjectSetup } from "../src/lib/projectSetup.js";
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
  setupClient.getRepositoryPathType ??= async (_repository, path) => setupClient.contents.has(path) ? "file" : setupClient.directories?.has(path) ? "directory" : null;
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

function putFile(client: DeterministicFakeGithubClient, path: string, value: unknown): void {
  client.contents.set(path, { path, sha: `sha-${path}`, content: Buffer.from(JSON.stringify(value)).toString("base64") });
}

function putReadyProfile(client: DeterministicFakeGithubClient): void {
  putFile(client, GITHUB_WORK_PROFILE_PATH, { version: GITHUB_WORK_PROFILE_VERSION, capabilities: ["github-work-items"], skillPaths: [".agents/skills"] });
  const directories = client as unknown as { directories?: Set<string> };
  directories.directories ??= new Set<string>();
  directories.directories.add(".agents/skills");
}

function putRequiredLabels(client: DeterministicFakeGithubClient): void {
  client.labels.push({ name: "ready-for-dev" }, { name: "waiting-human" }, { name: "blocked" });
}

test("reports an empty repository as setup-required with repairable items", async () => {
  const readiness = await inspectProjectSetup(project, runtime(new DeterministicFakeGithubClient()));
  assert.equal(readiness.ready, false);
  assert.equal(readiness.requirements.find(({ key }) => key === "ade-config")?.state, "missing");
  assert.equal(readiness.requirements.find(({ key }) => key === "github-labels")?.state, "missing");
  assert.ok(readiness.missingFiles.includes(GITHUB_WORK_PROFILE_PATH));
  assert.ok(readiness.plannedFiles.includes(".github/ISSUE_TEMPLATE/ade-work.yml"));
});

test("distinguishes invalid configuration from missing configuration", async () => {
  const client = new DeterministicFakeGithubClient();
  putFile(client, GITHUB_WORK_PROFILE_PATH, { version: "wrong", capabilities: [] });
  const readiness = await inspectProjectSetup(project, runtime(client));
  assert.equal(readiness.requirements.find(({ key }) => key === "ade-config")?.state, "invalid");
  assert.equal(readiness.missingFiles.includes(GITHUB_WORK_PROFILE_PATH), false);
  assert.ok(readiness.invalidFiles.includes(GITHUB_WORK_PROFILE_PATH));
});

test("blocks readiness when a declared skill directory is missing", async () => {
  const client = new DeterministicFakeGithubClient();
  putFile(client, GITHUB_WORK_PROFILE_PATH, { version: GITHUB_WORK_PROFILE_VERSION, capabilities: ["github-work-items"], skillPaths: [".agents/skills"] });
  client.contents.set("AGENTS.md", { path: "AGENTS.md", sha: "agents", content: Buffer.from("# Instructions").toString("base64") });
  putRequiredLabels(client);
  const readiness = await inspectProjectSetup(project, runtime(client));
  const skills = readiness.requirements.find(({ key }) => key === "skills");
  assert.equal(readiness.ready, false);
  assert.equal(skills?.state, "missing");
  assert.match(skills?.detail ?? "", /\.agents\/skills/);
});

test("recognizes a fully configured repository while keeping optional files visible", async () => {
  const client = new DeterministicFakeGithubClient();
  putReadyProfile(client);
  client.contents.set("AGENTS.md", { path: "AGENTS.md", sha: "agents", content: Buffer.from("# Instructions").toString("base64") });
  putRequiredLabels(client);
  const readiness = await inspectProjectSetup(project, runtime(client));
  assert.equal(readiness.ready, true);
  assert.equal(readiness.requirements.find(({ key }) => key === "context")?.state, "optional");
  assert.equal(readiness.requirements.find(({ key }) => key === "github-labels")?.state, "ready");
});

test("blocks a stale runner proof until its checkout matches the default branch", async () => {
  const client = new DeterministicFakeGithubClient();
  putReadyProfile(client);
  client.contents.set("AGENTS.md", { path: "AGENTS.md", sha: "agents", content: Buffer.from("# Instructions").toString("base64") });
  putRequiredLabels(client);
  client.defaultBranchHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const readiness = await inspectProjectSetup(project, runtime(client), undefined, {
    projectId: project.id, repositoryGithubId: "123", compatible: true, contractVersion: GITHUB_WORK_PROFILE_VERSION,
    capabilities: ["github-work-items"], skillPaths: [".agents/skills"], reason: "compatible", observedAt: "2026-08-27T10:00:00.000Z",
    adeStatus: "compatible", adeRuntimeVersion: "0.11.0", adeConfigVersion: "ade.project-setup/v1",
    resolvedProfiles: ["normal"], resolvedRules: [], contextStatus: "fresh", missingRequiredCapabilityIds: [],
    runnerCheckoutRef: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  });
  assert.equal(readiness.ready, false);
  assert.match(readiness.requirements.find(({ key }) => key === "runner-capability-check")?.detail ?? "", /stale/);
});

test("reports GitHub App permission failures without claiming setup is ready", async () => {
  const client = new DeterministicFakeGithubClient();
  client.listLabels = async () => { throw new Error("forbidden"); };
  const readiness = await inspectProjectSetup(project, runtime(client));
  assert.equal(readiness.ready, false);
  assert.equal(readiness.requirements.find(({ key }) => key === "github-app")?.state, "invalid");
});

test("prepares only missing pieces and reuses the open setup PR on retry", async () => {
  const client = new DeterministicFakeGithubClient();
  const first = await prepareProjectSetup(project, runtime(client));
  const second = await prepareProjectSetup(project, runtime(client));
  assert.deepEqual(first.labelsCreated, ["ready-for-dev", "waiting-human", "blocked"]);
  assert.deepEqual(second.labelsCreated, []);
  assert.equal(first.pullRequestNumber, second.pullRequestNumber);
  assert.equal(client.createdPullRequests.length, 1);
});
