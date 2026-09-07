import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OverviewContent } from "../src/components/OverviewContent.js";
import { summarizeOverview } from "../src/lib/overview.js";
import { buildOverview } from "../src/lib/readModel.js";
import { overviewFixture, overviewIssue } from "./helpers/overview.js";

test("stale project projection does not degrade the global GitHub integration", async () => {
  const { input, state } = overviewFixture();
  state.githubWorkItems = [overviewIssue({ expiresAt: "2026-08-27T09:59:00.000Z" })];

  const view = await buildOverview(input);
  const summary = summarizeOverview(view);

  assert.equal(view.githubSync, "stale");
  assert.equal(summary.githubIntegration.status, "healthy");
  assert.equal(summary.githubIntegration.badgeLabel, "Connected");
  assert.ok(!summary.alerts.some(({ id }) => id === "github"));

  const html = renderToStaticMarkup(createElement(OverviewContent, { overview: view }));
  assert.match(html, />GitHub</);
  assert.match(html, />Connected</);
  assert.doesNotMatch(html, /GitHub sync needs checking/);
});

test("a failed worker cycle after a successful reconcile creates one actionable GitHub integration alert", async () => {
  const { input, state } = overviewFixture();
  const success = state.auditEvents[0]!;
  state.auditEvents = [
    {
      ...success,
      id: "github-failure",
      action: "worker.cycle-failed",
      occurredAt: "2026-08-27T10:00:30.000Z",
      metadata: { wakeReason: "periodic-full-reconcile" },
    },
    success,
  ];

  const view = await buildOverview(input);
  const summary = summarizeOverview(view);
  const githubAlert = summary.alerts.find(({ id }) => id === "github");

  assert.equal(view.workerHealth.status, "degraded-github");
  assert.equal(summary.githubIntegration.status, "degraded");
  assert.deepEqual(githubAlert, {
    id: "github",
    title: "GitHub integration needs attention",
    reason: "The latest worker cycle failed after the last successful GitHub reconciliation.",
    href: "/settings#github-integration",
    action: "Review integration",
    status: "blocked",
    label: "Needs attention",
  });
  assert.ok(!summary.alerts.some(({ id }) => id === "worker"));
});
