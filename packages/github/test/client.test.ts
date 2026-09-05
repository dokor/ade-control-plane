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

test("retains only a bounded safe GitHub validation detail", async () => {
  const client = new HttpGithubClient({
    installationId: "installation-1",
    tokens: { getToken: async () => "token" },
    fetchImplementation: async () => new Response(JSON.stringify({ errors: [{ message: "head branch does not exist" }, { message: "token=secret" }] }), { status: 422 }),
  });
  await assert.rejects(
    () => client.createPullRequest({ id: "1", owner: "dokor", name: "alpha" }, { title: "Task", body: "Body", head: "ade/task", base: "main" }),
    (error: unknown) => error instanceof Error && error.message.includes("GitHub API create pull request failed") && (error as { status?: number; detail?: string }).status === 422 && (error as { detail?: string }).detail === "head branch does not exist",
  );
});

test("reads repository label names through the authorized client", async () => {
  let requested = "";
  const client = new HttpGithubClient({
    installationId: "installation-1",
    tokens: { getToken: async () => "short-lived-token" },
    fetchImplementation: async (url) => {
      requested = String(url);
      return Response.json([
        { name: "backlog-refined", color: "123456" },
        { name: "ready-for-dev", color: "abcdef" },
      ]);
    },
  });
  assert.deepEqual(
    await client.listRepositoryLabels({ id: "1", owner: "dokor", name: "alpha" }),
    ["backlog-refined", "ready-for-dev"],
  );
  assert.equal(requested, "https://api.github.com/repos/dokor/alpha/labels?per_page=100");
});

test("finds an exact open pull request by head and base", async () => {
  let requested = "";
  const client = new HttpGithubClient({
    installationId: "installation-1",
    tokens: { getToken: async () => "token" },
    fetchImplementation: async (url) => {
      requested = String(url);
      return Response.json([{ number: 7, html_url: "https://github.com/dokor/alpha/pull/7", head: { ref: "ade/task" }, base: { ref: "main" } }]);
    },
  });
  const pullRequest = await client.findPullRequest({ id: "1", owner: "dokor", name: "alpha" }, "ade/task", "main");
  assert.equal(pullRequest?.number, 7);
  assert.match(requested, /head=dokor%3Aade%2Ftask/);
  assert.match(requested, /base=main/);
});
