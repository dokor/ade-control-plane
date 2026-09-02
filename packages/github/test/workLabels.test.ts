import assert from "node:assert/strict";
import test from "node:test";

import { labelsForGithubWorkState, mergeAdeWorkflowLabels } from "../src/workLabels.js";

test("projects only ADE-owned labels from the durable workflow state", () => {
  assert.deepEqual(labelsForGithubWorkState("ready", null), ["backlog-refined", "ready-for-dev"]);
  assert.deepEqual(labelsForGithubWorkState("running", null), ["in-progress"]);
  assert.deepEqual(labelsForGithubWorkState("waiting-human", 42), ["waiting-human", "pr-ready"]);
  assert.deepEqual(labelsForGithubWorkState("blocked", null), ["blocked"]);
});

test("preserves repository labels and removes stale ADE labels idempotently", () => {
  const first = mergeAdeWorkflowLabels(
    ["bug", "security", "ready-for-dev", "in-progress"],
    ["waiting-human", "pr-ready"],
  );
  assert.deepEqual(first, ["bug", "pr-ready", "security", "waiting-human"]);
  assert.deepEqual(mergeAdeWorkflowLabels(first, ["waiting-human", "pr-ready"]), first);
});
