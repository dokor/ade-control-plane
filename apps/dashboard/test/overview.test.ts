import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OverviewContent, OverviewLoading, OverviewUnavailable } from "../src/components/OverviewContent.js";
import { buildOverview } from "../src/lib/readModel.js";
import { summarizeOverview } from "../src/lib/overview.js";
import { overviewFixture, overviewIssue } from "./helpers/overview.js";
import { execution, NOW } from "./helpers/fixtures.js";

test("healthy Overview gives a next action and keeps capacity below work", async () => {
  const { input } = overviewFixture();
  const view = await buildOverview(input);
  assert.equal(summarizeOverview(view).headline, "Ready for work");
  const html = renderToStaticMarkup(createElement(OverviewContent, { overview: view }));
  assert.match(html, /No blockers or pending human actions/);
  assert.match(html, /No active executions/);
  assert.match(html, /1 of 1 ADE-ready/);
  assert.ok(html.indexOf("Attention required") < html.indexOf("Running now"));
  assert.ok(html.indexOf("Running now") < html.indexOf("AI capacity"));
  assert.match(html, /href="\/tasks"/);
});

test("every blocked or waiting issue in one project gets its own detail action", async () => {
  const { input, state } = overviewFixture();
  state.githubWorkItems = [overviewIssue({ state: "waiting-human" }), overviewIssue({ id: "work-2", issueNumber: 22, state: "blocked" })];
  state.settings.schedulerMode = "paused";
  const view = await buildOverview(input);
  const html = renderToStaticMarkup(createElement(OverviewContent, { overview: view }));
  assert.match(html, /Scheduling is paused/);
  assert.match(html, /GitHub issue #21/);
  assert.match(html, /GitHub issue #22/);
  assert.match(html, /\/tasks\/github\/11111111-1111-4111-8111-111111111111\/22/);
  assert.equal(summarizeOverview(view).alerts.filter(({ action }) => action === "Review work").length, 2);
});

test("empty Overview guides registration without claiming operational readiness", async () => {
  const { input, state } = overviewFixture();
  state.projects = []; state.githubWorkProfiles = [];
  const view = await buildOverview(input);
  const html = renderToStaticMarkup(createElement(OverviewContent, { overview: view }));
  assert.match(html, /Connect your first project/);
  assert.match(html, /Register a project/);
  assert.doesNotMatch(html, /Ready for work/);
});

test("partial backend failure preserves projects and explicitly marks unknown capacity", async () => {
  const { input, persistence } = overviewFixture();
  persistence.providerQuotaSnapshots.getLatest = async () => { throw new Error("postgres://user:password@private-host/db"); };
  const view = await buildOverview(input);
  assert.deepEqual(view.unavailableSections, ["Provider quota"]);
  assert.equal(view.projects.length, 1);
  const html = renderToStaticMarkup(createElement(OverviewContent, { overview: view }));
  assert.match(html, /Partial view/);
  assert.match(html, /Usage not reported/);
  assert.doesNotMatch(html, /password|private-host|Ready for work/);
  assert.match(renderToStaticMarkup(createElement(OverviewUnavailable)), /temporarily unavailable/);
  assert.match(renderToStaticMarkup(createElement(OverviewLoading)), /aria-busy="true"/);
});

test("durable workflow stage and elapsed time are shown with the correlated execution", async () => {
  const { input, state, persistence } = overviewFixture();
  state.executions = [execution({ status: "running", workRef: "github:issue:21", startedAt: "2026-08-27T09:58:00.000Z", errorCode: null, errorSummary: null })];
  state.githubWorkItems = [overviewIssue({ state: "running", executionRef: state.executions[0]!.id })];
  input.persistence = { ...persistence, deliveryWorkflows: { ...persistence.deliveryWorkflows!, getByExecutionId: async () => ({
    id: "workflow", executionId: state.executions[0]!.id, projectId: state.projects[0]!.id, issueNumber: 21,
    sourceUpdatedAt: NOW, stage: "validating", attempt: 1, adePlan: null, provenance: null, providerExecutionRef: null,
    validationSummary: null, reviewSummary: null, branchName: null, headSha: null, pullRequestNumber: null,
    pullRequestUrl: null, retryClassification: null, reconciliationRequired: false, humanDecisionRef: null,
    transitionReason: "Checks in progress", createdAt: NOW, updatedAt: NOW,
  }) } };
  let view = await buildOverview(input);
  const html = renderToStaticMarkup(createElement(OverviewContent, { overview: view }));
  assert.match(html, /validating/);
  assert.match(html, /Elapsed 2m 0s/);
  state.executions[0]!.status = "unknown";
  view = await buildOverview(input);
  assert.equal(view.work[0]!.status, "reconciling");
  assert.equal(summarizeOverview(view).active.length, 0);
  state.githubWorkItems[0]!.state = "completed";
  view = await buildOverview(input);
  assert.equal(view.work[0]!.status, "completed");
});

test("missing workload data never renders the no-active-execution empty state", async () => {
  const { input, persistence } = overviewFixture();
  persistence.executions.listActive = async () => { throw new Error("unavailable"); };
  const view = await buildOverview(input);
  const html = renderToStaticMarkup(createElement(OverviewContent, { overview: view }));
  assert.match(html, /Active work could not be fully loaded/);
  assert.doesNotMatch(html, /No active executions/);
});

test("worker health uses the most recent cycle instead of the oldest audit", async () => {
  const { input, state } = overviewFixture();
  state.auditEvents = [
    { ...state.auditEvents[0]!, id: "failure", action: "worker.cycle-failed", occurredAt: "2026-08-27T09:59:00.000Z" },
    { ...state.auditEvents[0]!, id: "old-success", occurredAt: "2026-08-27T09:50:00.000Z" },
    state.auditEvents[0]!,
  ];
  assert.equal((await buildOverview(input)).workerHealth.status, "idle");
});

test("another online runner cannot make an unobserved production worker healthy", async () => {
  const { input, state } = overviewFixture();
  state.runners[0]!.name = "another-runner";
  const view = await buildOverview(input);
  assert.equal(view.workerHealth.status, "stale/unhealthy");
  assert.notEqual(summarizeOverview(view).headline, "Ready for work");
});

test("stale issues do not imply healthy GitHub sync even with a fresh repository profile", async () => {
  const { input, state } = overviewFixture();
  state.githubWorkItems = [overviewIssue({ expiresAt: "2026-08-27T09:59:00.000Z" })];
  const view = await buildOverview(input);
  assert.equal(view.githubSync, "stale");
  assert.notEqual(summarizeOverview(view).headline, "Ready for work");
});
