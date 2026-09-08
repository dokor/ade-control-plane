import assert from "node:assert/strict";
import test from "node:test";

import { milestoneDisplay } from "../src/components/ProjectIssueQueue.js";

test("shows only milestone values backed by a current projection", () => {
  assert.equal(milestoneDisplay({ milestone: "Release 2", projectionState: "current" }), "Release 2");
  assert.equal(milestoneDisplay({ milestone: null, projectionState: "current" }), "—");
  assert.equal(milestoneDisplay({ milestone: "Old release", projectionState: "stale" }), "stale");
  assert.equal(milestoneDisplay({ milestone: null, projectionState: "unknown" }), "unknown");
});
