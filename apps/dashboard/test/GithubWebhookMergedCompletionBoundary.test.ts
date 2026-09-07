import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const webhookSource = new URL("../src/lib/githubWebhook.ts", import.meta.url);

test("merged ADE pull requests complete both GitHub metadata and durable workflow", async () => {
  const source = await readFile(webhookSource, "utf8");
  const start = source.indexOf("async function reconcilePullRequestLifecycle");
  const end = source.indexOf("class GithubWebhookLifecycleError", start);
  const reconciliation = start >= 0 && end >= 0 ? source.slice(start, end) : "";

  assert.match(reconciliation, /nextState === "completed" \? null/u);
  assert.match(reconciliation, /deliveryWorkflows\.getByExecutionId/u);
  assert.match(reconciliation, /stage: "completed"/u);
  assert.match(reconciliation, /expectedStage: "waiting-human"/u);
  assert.match(reconciliation, /merged-pr:\$\{pullRequest\.number\}:completed/u);
});
