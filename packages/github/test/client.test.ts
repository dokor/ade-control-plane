import assert from "node:assert/strict";
import test from "node:test";

import { HttpGithubClient } from "../src/client.js";

test("creates a pull request through the narrow GitHub App surface", async () => {
  let request: { url: string; init: RequestInit } | null = null;
  const client = new HttpGithubClient({
    installationId: "installation-1",
    tokens: { getToken: async () => "short-lived-token" },
    fetchImplementation: async (url, init) => {
      request = { url: String(url), init: init ?? {} };
      return Response.json({
        number: 42,
        html_url: "https://github.com/dokor/alpha/pull/42",
        head: { ref: "ade/task" },
        base: { ref: "main" },
      });
    },
  });

  const pullRequest = await client.createPullRequest(
    { id: "1", owner: "dokor", name: "alpha" },
    { title: "Task", body: "@dokor", head: "ade/task", base: "main" },
  );

  assert.equal(pullRequest.number, 42);
  assert.equal(request?.url, "https://api.github.com/repos/dokor/alpha/pulls");
  assert.deepEqual(JSON.parse(String(request?.init.body)), {
    title: "Task",
    body: "@dokor",
    head: "ade/task",
    base: "main",
  });
  assert.equal(
    (request?.init.headers as Record<string, string>).authorization,
    "Bearer short-lived-token",
  );
});

test("does not expose a malformed GitHub response", async () => {
  const client = new HttpGithubClient({
    installationId: "installation-1",
    tokens: { getToken: async () => "token" },
    fetchImplementation: async () => Response.json({ message: "unexpected" }),
  });
  await assert.rejects(
    () => client.createPullRequest(
      { id: "1", owner: "dokor", name: "alpha" },
      { title: "Task", body: "Body", head: "ade/task", base: "main" },
    ),
    /response is invalid/,
  );
});
