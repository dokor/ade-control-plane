import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OverviewContent } from "../src/components/OverviewContent.js";
import { summarizeOverview } from "../src/lib/overview.js";
import type { OverviewProjectReadinessPresentation } from "../src/lib/overviewReadiness.js";
import { buildOverview } from "../src/lib/readModel.js";
import { overviewFixture } from "./helpers/overview.js";

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
  const presentation: OverviewProjectReadinessPresentation[] = [
    { id: "setup", ready: false, status: "setup-required", label: "Setup required", progress: 1_040 },
    { id: "incompatible", ready: false, status: "incompatible", label: "Incompatible", progress: 2_060 },
    { id: "initializing", ready: false, status: "initializing", label: "Initializing", progress: 2_085 },
    { id: "ready", ready: true, status: "ready", label: "Ready", progress: 3_090 },
  ];

  const summary = summarizeOverview(overview, presentation);
  assert.equal(summary.ready, 1);
  assert.deepEqual(summary.readiness.map(({ id }) => id), ["ready", "initializing", "incompatible", "setup"]);
  assert.deepEqual(summary.readiness.map(({ badgeLabel }) => badgeLabel), ["Ready", "Initializing", "Incompatible", "Setup required"]);

  const html = renderToStaticMarkup(createElement(OverviewContent, { overview, projectReadiness: presentation }));
  assert.ok(html.indexOf("Ready project") < html.indexOf("Initializing project"));
  assert.ok(html.indexOf("Initializing project") < html.indexOf("Incompatible project"));
  assert.ok(html.indexOf("Incompatible project") < html.indexOf("Setup project"));
  assert.match(html, />Initializing</);
  assert.match(html, />Setup required</);
});
