import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const webhookSource = new URL("../src/lib/githubWebhook.ts", import.meta.url);

test("merged ADE pull requests complete both GitHub metadata and durable workflow", async () => {
  const source = await readFile(webhookSource, "utf8");
  const reconciliation = source.match(/async function reconcilePullRequestLifecycle[\s\S]*?\n}\n\nclass GithubWebhookLifecycleError/u)?.[0] ?? "";

  assert.match(reconciliation, /nextState === "completed" \? null/u);
  assert.match(reconciliation, /deliveryWorkflows\.getByExecutionId/u);
  assert.match(reconciliation, /stage: "completed"/u);
  assert.match(reconciliation, /expectedStage: "waiting-human"/u);
  assert.match(reconciliation, /merged-pr:\$\{pullRequest\.number\}:completed/u);
});
