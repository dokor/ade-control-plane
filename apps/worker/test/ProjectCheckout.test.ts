import assert from "node:assert/strict";
import test from "node:test";

import { matchesGithubRemote, resolveProjectCheckout } from "../src/v0/ProjectCheckout.js";
import type { ProjectRecord } from "@ade-control-plane/database";

const project: ProjectRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "alpha",
  name: "Alpha",
  repositoryOwner: "dokor",
  repositoryName: "alpha",
  repositoryId: null,
  state: "enabled",
  priority: 50,
  adeAdapter: "local",
  runnerPolicy: {},
  configuration: { v0: { checkout: "../escape", baseBranch: "main" } },
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
};

test("rejects traversal before resolving a project checkout", async () => {
  await assert.rejects(
    () => resolveProjectCheckout("/srv/projects", project),
    /relative allow-listed path/,
  );
});

test("matches only the registered GitHub remote", () => {
  assert.equal(matchesGithubRemote("git@github.com:dokor/alpha.git", "dokor", "alpha"), true);
  assert.equal(matchesGithubRemote("https://github.com/dokor/alpha.git", "dokor", "alpha"), true);
  assert.equal(matchesGithubRemote("https://github.com/attacker/alpha.git", "dokor", "alpha"), false);
  assert.equal(matchesGithubRemote("https://token@github.com/dokor/alpha.git", "dokor", "alpha"), false);
  assert.equal(matchesGithubRemote("https://example.com/dokor/alpha.git", "dokor", "alpha"), false);
});
