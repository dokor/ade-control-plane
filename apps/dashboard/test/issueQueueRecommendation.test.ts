import assert from "node:assert/strict";
import test from "node:test";

import { recommendIssueQueue } from "../src/lib/issueQueueRecommendation.js";

const item = (number: number, overrides: Record<string, unknown> = {}) => ({
  number, title: `Issue ${number}`, state: "open" as const, url: `https://github.com/dokor/argos/issues/${number}`,
  updatedAt: "2026-09-08T10:00:00.000Z", adeState: null, priority: 0, description: "Description",
  runWhenAvailable: false, queuePosition: null, workState: null, pullRequestNumber: null, pullRequestUrl: null,
  projectionState: "current" as const, ...overrides,
});

test("proposes only fresh ADE-ready work in declared priority order with explanations", () => {
  const recommendation = recommendIssueQueue([
    item(10, { workState: "ready", priority: 30 }),
    item(11, { workState: "ready", priority: 80 }),
    item(12, { workState: "blocked", priority: 100 }),
    item(13, { workState: "ready", projectionState: "stale" }),
  ]);
  assert.deepEqual(recommendation.issueNumbers, [11, 10]);
  assert.match(recommendation.items.find(({ issueNumber }) => issueNumber === 11)?.reason ?? "", /declared priority 80/);
  assert.match(recommendation.items.find(({ issueNumber }) => issueNumber === 12)?.reason ?? "", /not eligible/);
  assert.match(recommendation.items.find(({ issueNumber }) => issueNumber === 13)?.reason ?? "", /stale/);
});

test("an empty or unavailable recommendation never changes manual queue intent", () => {
  const recommendation = recommendIssueQueue([item(14, { workState: null })]);
  assert.deepEqual(recommendation.issueNumbers, []);
  assert.match(recommendation.summary, /Manual queue settings remain unchanged/);
});
