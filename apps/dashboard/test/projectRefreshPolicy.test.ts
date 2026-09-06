import assert from "node:assert/strict";
import test from "node:test";

import { PROJECT_REFRESH_INTERVALS_MS, projectRefreshPolicy } from "../src/lib/projectRefreshPolicy.js";
import { summarizeProjectDetail } from "../src/lib/projectDetailPresentation.js";
import { projectDetailFixture } from "./helpers/projectDetail.js";

test("polls active initialization and execution states every fifteen seconds", async () => {
  const initializing = await projectDetailFixture("initializing");
  assert.deepEqual(projectRefreshPolicy(initializing.project, initializing.readiness, initializing.work), {
    mode: "active", intervalMs: PROJECT_REFRESH_INTERVALS_MS.active,
  });

  const executing = await projectDetailFixture("ready");
  executing.project.status = "running";
  assert.equal(projectRefreshPolicy(executing.project, executing.readiness, executing.work).mode, "active");
});

test("slows polling for an initialized stable project", async () => {
  const stable = await projectDetailFixture("ready");
  assert.deepEqual(projectRefreshPolicy(stable.project, stable.readiness, stable.work), {
    mode: "stable", intervalMs: PROJECT_REFRESH_INTERVALS_MS.stable,
  });
});

test("resumes short polling after a stable project enters reconciliation", async () => {
  const project = await projectDetailFixture("ready");
  assert.equal(projectRefreshPolicy(project.project, project.readiness, project.work).mode, "stable");
  project.project.status = "reconciling";
  assert.equal(projectRefreshPolicy(project.project, project.readiness, project.work).mode, "active");
});

test("backs off temporary inspection errors without inventing an active transition", async () => {
  const project = await projectDetailFixture("ready");
  project.readiness.inspectionFailed = true;
  assert.deepEqual(projectRefreshPolicy(project.project, project.readiness, project.work), {
    mode: "retry", intervalMs: PROJECT_REFRESH_INTERVALS_MS.retry,
  });
  const summary = summarizeProjectDetail(project.project, project.readiness, project.work);
  assert.equal(summary.status, project.project.status);
  assert.equal(summary.label, "Refresh unavailable");
  assert.match(summary.reason, /stored project state has not changed/);
});

test("a no-change stable read stays stable and has no event-producing policy result", async () => {
  const project = await projectDetailFixture("ready");
  const first = projectRefreshPolicy(project.project, project.readiness, project.work);
  const second = projectRefreshPolicy(project.project, project.readiness, project.work);
  assert.deepEqual(second, first);
  assert.deepEqual(Object.keys(second).sort(), ["intervalMs", "mode"]);
});
