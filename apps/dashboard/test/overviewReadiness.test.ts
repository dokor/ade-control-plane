import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OverviewContent } from "../src/components/OverviewContent.js";
import { summarizeOverview } from "../src/lib/overview.js";
import { presentOverviewProjectReadiness, type OverviewProjectReadinessPresentation } from "../src/lib/overviewReadiness.js";
import { buildOverview } from "../src/lib/readModel.js";
import { overviewFixture } from "./helpers/overview.js";
import { projectDetailFixture } from "./helpers/projectDetail.js";

function presentation(
  id: string,
  status: string,
  label: string,
  setupReady: boolean,
  progress: number,
  phase = "ready",
): OverviewProjectReadinessPresentation {
  return {
    id, setupReady, status, label, progress, phase,
    reason: `${label} reason`,
    actionLabel: "Review project",
    actionHref: `/projects/${id}`,
    needsAttention: ["setup-required", "incompatible", "blocked", "waiting-human", "waiting-runner", "reconciling", "unknown", "failed"].includes(status),
  };
}

test("project readiness uses project-page badges and sorts most configured first", async () => {
  const { input } = overviewFixture();
  const base = await buildOverview(input);
  const project = base.projects[0]!;
  const overview = {
    ...base,
    projects: [
      { ...project, id: "setup", name: "Setup project" },
      { ...project, id: "incompatible", name: "Incompatible project" },
      { ...project, id: "initializing", name: "Initializing project" },
      { ...project, id: "ready", name: "Ready project" },
    ],
  };
  const projectReadiness: OverviewProjectReadinessPresentation[] = [
    presentation("setup", "setup-required", "Setup required", false, 1_040, "repository"),
    presentation("incompatible", "incompatible", "Incompatible", false, 2_060, "initialization"),
    presentation("initializing", "initializing", "Initializing", false, 2_085, "initialization"),
    presentation("ready", "ready", "Ready", true, 3_090),
  ];

  const summary = summarizeOverview(overview, projectReadiness);
  assert.equal(summary.setupReady, 1);
  assert.deepEqual(summary.readiness.map(({ id }) => id), ["ready", "initializing", "incompatible", "setup"]);
  assert.deepEqual(summary.readiness.map(({ badgeLabel }) => badgeLabel), ["Ready", "Initializing", "Incompatible", "Setup required"]);

  const html = renderToStaticMarkup(createElement(OverviewContent, { overview, projectReadiness }));
  assert.ok(html.indexOf("Ready project") < html.indexOf("Initializing project"));
  assert.ok(html.indexOf("Initializing project") < html.indexOf("Incompatible project"));
  assert.ok(html.indexOf("Incompatible project") < html.indexOf("Setup project"));
  assert.match(html, /1 of 4 ADE setup-ready/);
  assert.match(html, />Initializing</);
  assert.match(html, />Setup required</);
});

test("setup-ready project with stale work projection keeps one canonical status across overview surfaces", async () => {
  const detail = await projectDetailFixture("ready");
  detail.project.status = "unknown";
  detail.project.waitingReason = "The GitHub work projection is stale or missing, so eligibility is unknown.";
  const canonical = presentOverviewProjectReadiness(detail.project, detail.readiness, detail.work);

  assert.equal(canonical.setupReady, true);
  assert.equal(canonical.status, "unknown");
  assert.equal(canonical.label, "Attention required");
  assert.equal(canonical.reason, detail.project.waitingReason);
  assert.equal(canonical.actionLabel, "Review work");
  assert.equal(canonical.actionHref, `/projects/${detail.project.id}#project-work`);

  const { input } = overviewFixture();
  const base = await buildOverview(input);
  const overview = { ...base, projects: base.projects.map((project) => project.id === detail.project.id ? { ...project, status: "unknown" as const, waitingReason: detail.project.waitingReason } : project) };
  const summary = summarizeOverview(overview, [canonical]);
  const projectAlert = summary.alerts.find(({ id }) => id === `project:${detail.project.id}`);

  assert.equal(summary.setupReady, 1);
  assert.equal(summary.readiness.find(({ id }) => id === detail.project.id)?.badgeLabel, canonical.label);
  assert.deepEqual(projectAlert, {
    id: `project:${detail.project.id}`,
    title: `${detail.project.name} · ${canonical.label}`,
    reason: canonical.reason,
    status: canonical.status,
    label: canonical.label,
    href: canonical.actionHref,
    action: canonical.actionLabel,
  });

  const html = renderToStaticMarkup(createElement(OverviewContent, { overview, projectReadiness: [canonical] }));
  assert.match(html, /ADE setup-ready/);
  assert.match(html, /Attention required/);
  assert.match(html, /The GitHub work projection is stale or missing, so eligibility is unknown\./);
});

test("specific work attention takes precedence over a redundant ready-phase project alert", async () => {
  const detail = await projectDetailFixture("blocked-work");
  const canonical = presentOverviewProjectReadiness(detail.project, detail.readiness, detail.work);
  const { input } = overviewFixture();
  const base = await buildOverview(input);
  const overview = {
    ...base,
    work: [...base.work.filter((item) => item.projectId !== detail.project.id), ...detail.work],
  };

  const summary = summarizeOverview(overview, [canonical]);
  assert.ok(summary.alerts.some(({ id }) => id === detail.work[0]!.id));
  assert.ok(!summary.alerts.some(({ id }) => id === `project:${detail.project.id}`));
});
