import assert from "node:assert/strict";
import test from "node:test";

import {
  HttpGithubIssueAdapter,
  normalizeGithubIssueSummary,
  type GithubRepositoryRef,
} from "../src/index.js";

const repository: GithubRepositoryRef = {
  id: "123",
  owner: "dokor",
  name: "argos",
};

test("normalizes bounded issue metadata and excludes pull requests", () => {
  const issue = normalizeGithubIssueSummary({
    number: 23,
    title: "Add the showcase page",
    state: "open",
    html_url: "https://github.com/dokor/argos/issues/23",
    updated_at: "2026-08-31T20:00:00.000Z",
  }, repository);
  assert.deepEqual(issue, {
    number: 23,
    title: "Add the showcase page",
    state: "open",
    url: "https://github.com/dokor/argos/issues/23",
    updatedAt: "2026-08-31T20:00:00.000Z",
  });
  assert.equal(normalizeGithubIssueSummary({
    number: 24,
    title: "A PR",
    state: "open",
    html_url: "https://github.com/dokor/argos/issues/24",
    updated_at: "2026-08-31T20:00:00.000Z",
    pull_request: {},
  }, repository), null);
});

test("lists issue summaries without retaining bodies", async () => {
  const requests: string[] = [];
  const adapter = new HttpGithubIssueAdapter({
    tokens: { getToken: async () => "test-token" },
    installationId: "installation",
    baseUrl: "https://api.github.test",
    fetchImplementation: async (input) => {
      requests.push(String(input));
      return new Response(JSON.stringify([{
        number: 23,
        title: "Issue title",
        body: "must not be returned",
        state: "open",
        html_url: "https://github.com/dokor/argos/issues/23",
        updated_at: "2026-08-31T20:00:00.000Z",
      }]), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const issues = await adapter.listIssues(repository);
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0], {
    number: 23,
    title: "Issue title",
    state: "open",
    url: "https://github.com/dokor/argos/issues/23",
    updatedAt: "2026-08-31T20:00:00.000Z",
  });
  assert.match(requests[0] ?? "", /issues\?state=all/);
});
