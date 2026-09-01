import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { ProjectRecord } from "@ade-control-plane/database";

import { ProjectDeletionProcessor } from "../src/v0/ProjectDeletionProcessor.js";

const project: ProjectRecord = {
  id: "project-1", slug: "alpha", name: "Alpha", repositoryOwner: "dokor", repositoryName: "alpha", repositoryId: null,
  state: "disabled", priority: 1, adeAdapter: "github-work", runnerPolicy: {}, configuration: { v0: { checkout: "alpha", baseBranch: "main" } },
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
};

test("removes a verified managed checkout before deleting its database project", async () => {
  const root = await mkdtemp(join(tmpdir(), "ade-project-delete-"));
  const checkout = join(root, "alpha");
  await mkdir(checkout);
  let deleted = false;
  const processor = new ProjectDeletionProcessor({
    persistence: { projects: {
      listDeletionRequests: async () => deleted ? [] : [{ projectId: project.id, requestedAt: "2026-09-01T00:00:00.000Z" }],
      getById: async () => deleted ? null : project,
      delete: async () => { deleted = true; return true; },
    } },
    commands: { run: async ({ args }) => ({ exitCode: 0, signal: null, stdout: args.includes("worktree") ? `worktree ${checkout}\n` : "git@github.com:dokor/alpha.git\n", stderr: "" }) },
    projectRoot: root,
    gitEnvironment: {},
  });
  try {
    assert.equal(await processor.processPending(), true);
    assert.equal(deleted, true);
    await assert.rejects(() => access(checkout));
    assert.equal(await processor.processPending(), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("refuses a checkout whose Git remote is not the registered repository", async () => {
  const root = await mkdtemp(join(tmpdir(), "ade-project-delete-"));
  await mkdir(join(root, "alpha"));
  let deleted = false;
  const processor = new ProjectDeletionProcessor({
    persistence: { projects: { listDeletionRequests: async () => [{ projectId: project.id, requestedAt: "2026-09-01T00:00:00.000Z" }], getById: async () => project, delete: async () => { deleted = true; return true; } } },
    commands: { run: async () => ({ exitCode: 0, signal: null, stdout: "git@github.com:dokor/other.git\n", stderr: "" }) }, projectRoot: root, gitEnvironment: {},
  });
  try { await assert.rejects(() => processor.processPending(), /remote does not match/); assert.equal(deleted, false); }
  finally { await rm(root, { recursive: true, force: true }); }
});
