import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectSetupPanel } from "../src/components/ProjectSetupPanel.js";
import { summarizeProjectDetail } from "../src/lib/projectDetailPresentation.js";
import { buildProjectDetail } from "../src/lib/readModel.js";
import { projectDetailFixture, projectDetailStates } from "./helpers/projectDetail.js";
import { overviewFixture } from "./helpers/overview.js";
import { NOW, project } from "./helpers/fixtures.js";

for (const state of projectDetailStates) test(`project detail renders ${state} with one primary action and three steps`, async () => {
  const props = await projectDetailFixture(state);
  const html = renderToStaticMarkup(createElement(ProjectSetupPanel, props));
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
  assert.equal((html.match(/class="(?:button )?primary"/g) ?? []).length, 1);
  for (const label of ["Prepare repository", "Initialize ADE", "Ready for work", "Repository setup", "ADE capabilities", "GitHub integration", "Project state", "ADE environment", "Technical details"]) assert.ok(html.includes(label), label);
  assert.match(html, /<details class="project-disclosure"><summary>Optional improvements/);
  assert.doesNotMatch(html, /None reported by ADE/);
  const expected = { new: "Create setup PR", "setup-required": "Create setup PR", "pr-pending": "Review setup PR", initializing: "View initialization",
    ready: "Open tasks", incompatible: "Incompatible", stale: "Older revision — recheck required", "blocked-work": "Review blocked work", disabled: "Review controls" };
  assert.ok(html.includes(expected[state]), expected[state]);
});

test("missing runner evidence is unknown, not a stale work snapshot", async () => {
  const props = await projectDetailFixture("new");
  props.project.snapshotFresh = false;
  const html = renderToStaticMarkup(createElement(ProjectSetupPanel, props));
  assert.match(html, /Not yet evaluated/);
  assert.doesNotMatch(html, /Older revision — recheck required/);
  assert.equal((html.match(/No current or queued work/g) ?? []).length, 1);
});

test("manual invalid configuration takes priority over repairable optional files", async () => {
  const props = await projectDetailFixture("setup-required");
  props.readiness.requirements = props.readiness.requirements.map((item) => item.key === "ade-config" ? { ...item, state: "invalid", repairable: false } : item);
  const summary = summarizeProjectDetail(props.project, props.readiness, props.work);
  assert.equal(summary.status, "incompatible");
  assert.equal(summary.action.href, "#project-checks");
  assert.equal(summary.action.prepare, undefined);
});

test("a failed PR lookup offers refresh, not creation", async () => {
  const props = await projectDetailFixture("setup-required");
  props.readiness.setupPullRequestLookupFailed = true;
  assert.equal(summarizeProjectDetail(props.project, props.readiness, []).action.refresh, true);
});

test("initialization dominates old failures and cannot be queued again", async () => {
  const props = await projectDetailFixture("initializing");
  props.work = [{ ...props.work[0]!, id: "old", status: "failed", active: false, needsAttention: true }, ...props.work];
  const summary = summarizeProjectDetail(props.project, props.readiness, props.work);
  assert.equal(summary.status, "initializing");
  assert.equal(summary.action.prepare, undefined);
  assert.equal(summary.action.href, "/tasks/task-1");
});

test("persisted initialization is restored only on its own project", async () => {
  const { state, input } = overviewFixture();
  state.v0Tasks.push({ id: "initialization", projectId: project().id, source: { type: "ade-initialize" }, prompt: "not exposed",
    status: "PENDING", cancelRequested: false, branchName: null, pullRequestNumber: null, pullRequestUrl: null,
    errorCode: null, errorSummary: null, createdAt: NOW, startedAt: null, finishedAt: null, updatedAt: NOW });
  let detail = await buildProjectDetail({ ...input, projectId: project().id });
  assert.equal(detail?.work.find((item) => item.id === "initialization")?.initialization, true);
  assert.doesNotMatch(JSON.stringify(detail?.work), /not exposed/);
  state.v0Tasks[0]!.projectId = "other-project";
  detail = await buildProjectDetail({ ...input, projectId: project().id });
  assert.equal(detail?.work.length, 0);
});

test("completed work is not mislabeled as next work", async () => {
  const props = await projectDetailFixture("blocked-work");
  props.work = [{ ...props.work[0]!, status: "completed", needsAttention: false }];
  assert.equal(summarizeProjectDetail(props.project, props.readiness, props.work).visibleWork.length, 0);
});

test("pending mutations disable the action and failures are announced", async () => {
  const props = await projectDetailFixture("setup-required");
  const pending = renderToStaticMarkup(createElement(ProjectSetupPanel, { ...props, pending: true }));
  assert.match(pending, /class="primary" type="button" disabled=""/);
  const failed = renderToStaticMarkup(createElement(ProjectSetupPanel, { ...props, error: true, message: "Setup failed" }));
  assert.match(failed, /role="alert"[^>]*>Setup failed/);
});

test("paused scheduling and missing runners do not appear ready to execute", async () => {
  const props = await projectDetailFixture("ready");
  props.project.status = "paused";
  assert.equal(summarizeProjectDetail(props.project, props.readiness, []).label, "Scheduling paused");
  props.project.status = "waiting-runner"; props.project.exclusion = "no-compatible-runner";
  assert.equal(summarizeProjectDetail(props.project, props.readiness, []).action.href, "/runners");
});

test("pending human review stays amber rather than becoming a blocking error", async () => {
  const props = await projectDetailFixture("blocked-work");
  props.work = [{ ...props.work[0]!, status: "waiting-human" }];
  const summary = summarizeProjectDetail(props.project, props.readiness, props.work);
  assert.equal(summary.status, "waiting-human");
  assert.equal(summary.label, "Waiting for review");
  const html = renderToStaticMarkup(createElement(ProjectSetupPanel, props));
  assert.match(html, /badge-warning">Waiting for review/);
});
