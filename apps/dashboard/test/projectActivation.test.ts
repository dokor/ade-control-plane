import assert from "node:assert/strict";
import test from "node:test";

import { DeterministicFakeGithubClient, GITHUB_WORK_PROFILE_PATH, GITHUB_WORK_PROFILE_VERSION } from "@ade-control-plane/github";

import { prepareProjectActivation } from "../src/lib/projectActivation.js";
import { createMemoryPersistence, createMemoryState } from "./helpers/memoryPersistence.js";
import { project } from "./helpers/fixtures.js";
import type { GithubRuntime } from "../src/lib/githubRuntime.js";

function runtime(client: DeterministicFakeGithubClient): GithubRuntime {
  const setupClient = client as unknown as {
    contents: Map<string, unknown>;
    directories?: Set<string>;
    getRepositoryPathType?: (_repository: unknown, path: string) => Promise<"file" | "directory" | null>;
  };
  setupClient.directories ??= new Set<string>();
  setupClient.getRepositoryPathType ??= async (_repository, path) => setupClient.contents.has(path) ? "file" : setupClient.directories?.has(path) ? "directory" : null;
  return { webhookSecret: null, policy: { allowedActorIds: [], allowedInstallationIds: [] }, dashboardUrl: "https://control.example", quotaProvider: "openai", quotaAccountRef: "main", client, workReader: undefined, issueReader: undefined };
}

test("Prepare ADE queues initialization once repository setup is already ready", async () => {
  const current = project({ configuration: {} });
  const client = new DeterministicFakeGithubClient();
  const githubRuntime = runtime(client);
  client.contents.set(GITHUB_WORK_PROFILE_PATH, { path: GITHUB_WORK_PROFILE_PATH, sha: "profile", content: Buffer.from(JSON.stringify({ version: GITHUB_WORK_PROFILE_VERSION, capabilities: ["github-work-items"], skillPaths: [".agents/skills"] })).toString("base64") });
  client.contents.set("AGENTS.md", { path: "AGENTS.md", sha: "instructions", content: Buffer.from("# Instructions").toString("base64") });
  (client as unknown as { directories: Set<string> }).directories.add(".agents/skills");
  client.labels.push({ name: "ready-for-dev" }, { name: "waiting-human" }, { name: "blocked" });
  const persistence = createMemoryPersistence(createMemoryState({ projects: [current] }));
  const result = await prepareProjectActivation(persistence, current, githubRuntime);
  assert.equal(result.readiness.ready, false, JSON.stringify(result.readiness.requirements));
  assert.equal(result.readiness.requirements.find(({ key }) => key === "runner-capability-check")?.state, "missing");
  assert.deepEqual(result.initializationTask?.source, { type: "ade-initialize" });
});
