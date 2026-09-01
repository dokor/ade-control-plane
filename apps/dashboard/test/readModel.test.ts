import assert from "node:assert/strict";
import test from "node:test";

import { buildOverview, buildProjectDetail } from "../src/lib/readModel.js";
import {
  createMemoryPersistence,
  createMemoryState,
  type MemoryState,
} from "./helpers/memoryPersistence.js";
import {
  execution,
  NOW,
  project,
  quotaSnapshot,
  runner,
  snapshot,
} from "./helpers/fixtures.js";

const SECOND_PROJECT_ID = "99999999-9999-4999-8999-999999999999";

function input(state: MemoryState, overrides: { now?: string } = {}) {
  return {
    persistence: createMemoryPersistence(state),
    quotaProvider: "openai",
    quotaAccountRef: "codex-account-main",
    now: overrides.now ?? NOW,
  };
}

function twoProjectState(): MemoryState {
  return createMemoryState({
    projects: [
      project(),
      project({
        id: SECOND_PROJECT_ID,
        slug: "dvv",
        name: "DVV",
        repositoryName: "dvv",
        priority: 40,
      }),
    ],
    githubWorkProfiles: [
      { projectId: project().id, repositoryGithubId: "123", compatible: true, contractVersion: "ade.github-work-profile/v1", capabilities: ["github-work-items"], skillPaths: [".agents/skills"], reason: "compatible", observedAt: NOW },
      { projectId: SECOND_PROJECT_ID, repositoryGithubId: "456", compatible: true, contractVersion: "ade.github-work-profile/v1", capabilities: ["github-work-items", "human-decisions"], skillPaths: [".agents/skills"], reason: "compatible", observedAt: NOW },
    ],
    githubWorkItems: [
      { id: "77777777-7777-4777-8777-777777777777", projectId: project().id, repositoryGithubId: "123", contractVersion: "ade.github-work/v1", issueNumber: 21, issueUrl: "https://github.com/dokor/argos/issues/21", state: "ready", priority: 70, dependsOn: [], retryPolicy: "reconcile-first", humanDecisionRef: null, executionRef: null, branchName: null, pullRequestNumber: null, sourceUpdatedAt: NOW, observedAt: NOW, expiresAt: "2026-08-27T10:05:00.000Z", present: true },
      { id: "88888888-8888-4888-8888-888888888888", projectId: SECOND_PROJECT_ID, repositoryGithubId: "456", contractVersion: "ade.github-work/v1", issueNumber: 22, issueUrl: "https://github.com/dokor/dvv/issues/22", state: "waiting-human", priority: 90, dependsOn: [], retryPolicy: "reconcile-first", humanDecisionRef: "decision:22", executionRef: null, branchName: null, pullRequestNumber: null, sourceUpdatedAt: NOW, observedAt: NOW, expiresAt: "2026-08-27T10:05:00.000Z", present: true },
    ],
    runners: [runner()],
    quotaSnapshots: [quotaSnapshot()],
  });
}

test("shows two projects with distinct, explained states", async () => {
  const overview = await buildOverview(input(twoProjectState()));

  assert.equal(overview.projects.length, 2);
  const argos = overview.projects.find(({ slug }) => slug === "argos");
  const dvv = overview.projects.find(({ slug }) => slug === "dvv");
  assert.equal(argos?.status, "ready");
  assert.equal(dvv?.status, "waiting-human");
  assert.ok(dvv?.waitingReason);
  // The attention queue must surface the human decision first.
  assert.equal(overview.attention[0]?.projectId, SECOND_PROJECT_ID);
});

test("marks a project without an ADE snapshot as setup-required", async () => {
  const state = twoProjectState();
  state.projects = [project()];
  state.githubWorkProfiles = [];
  state.githubWorkItems = [];

  const overview = await buildOverview(input(state));

  assert.equal(overview.projects[0]?.adeStatus, "setup-required");
  assert.equal(overview.projects[0]?.adeRuntimeVersion, "unknown");
});

test("surfaces scheduler mode, quota and runner health", async () => {
  const overview = await buildOverview(input(twoProjectState()));

  assert.equal(overview.schedulerMode, "running");
  assert.equal(overview.quota.state, "normal");
  assert.equal(overview.quota.usedPercent, 12);
  assert.equal(overview.quota.resetsAt, "2026-08-27T11:00:00.000Z");
  assert.equal(overview.quota.snapshotAgeMs, 0);
  assert.equal(overview.runners[0]?.healthy, true);
  assert.match(overview.runnerHealthSummary, /healthy|online/);
});

test("never fabricates a quota percentage and flags a missing snapshot", async () => {
  const state = twoProjectState();
  state.quotaSnapshots = [];
  const overview = await buildOverview(input(state));

  assert.equal(overview.quota.state, "unknown");
  assert.equal(overview.quota.usedPercent, null);
  assert.equal(overview.quota.refreshRequired, true);
  assert.ok(overview.attention.some(({ key }) => key.startsWith("quota:")));
});

test("explains why the system is idle when globally paused", async () => {
  const state = twoProjectState();
  state.settings = { ...state.settings, schedulerMode: "paused" };
  const overview = await buildOverview(input(state));

  assert.match(overview.schedulerExplanation, /paused/i);
  assert.ok(overview.projects.every(({ status }) => status === "paused"));
});

test("explains per-project exclusion when the scheduler is running", async () => {
  const state = twoProjectState();
  state.runners = [runner({ state: "offline" })];
  const overview = await buildOverview(input(state));

  assert.match(overview.schedulerExplanation, /No project dispatched/);
  assert.match(overview.schedulerExplanation, /runner|human|paused/i);
});

test("marks a stale GitHub projection as unknown rather than idle", async () => {
  const state = twoProjectState();
  state.githubWorkItems[0] = { ...state.githubWorkItems[0]!, expiresAt: "2026-08-27T10:01:00.000Z" };
  const overview = await buildOverview(
    input(state, { now: "2026-08-27T11:00:00.000Z" }),
  );
  const argos = overview.projects.find(({ slug }) => slug === "argos");

  assert.equal(argos?.snapshotFresh, false);
  assert.equal(argos?.status, "unknown");
  assert.ok(overview.attention.some(({ key }) => key.startsWith("reconcile:")));
});

test("project detail exposes a sanitized timeline and gated controls", async () => {
  const state = twoProjectState();
  state.executions = [
    execution({
      status: "failed",
      errorCode: "ADE_TASK_FAILED",
      errorSummary: "process died reading /run/secrets/runner_auth_secret",
    }),
  ];
  const detail = await buildProjectDetail({ ...input(state), projectId: project().id });

  assert.ok(detail);
  assert.equal(detail.availableActions.canPause, true);
  // reconcile-first executions must not offer a Dashboard retry.
  assert.equal(detail.availableActions.safeRetryExecutionId, null);
  assert.ok(detail.timeline.length > 0);
  assert.doesNotMatch(
    JSON.stringify(detail.executions),
    /run\/secrets/,
  );
});

test("does not show reconciliation as a human decision when none is pending", async () => {
  const state = twoProjectState();
  state.projects = [project()];
  state.githubWorkProfiles = [];
  state.githubWorkItems = [];

  const detail = await buildProjectDetail({ ...input(state), projectId: project().id });

  assert.ok(detail);
  assert.equal(detail.openDecisions.length, 0);
  assert.equal(detail.humanDecisions.length, 0);
  assert.ok(detail.project.status === "unknown");
});

test("keeps a real waiting-human work item visible", async () => {
  const detail = await buildProjectDetail({
    ...input(twoProjectState()),
    projectId: SECOND_PROJECT_ID,
  });

  assert.ok(detail);
  assert.equal(detail.humanDecisions.length, 1);
  assert.match(detail.humanDecisions[0]?.title ?? "", /human decision/i);
});

test("returns null for an unknown project", async () => {
  const detail = await buildProjectDetail({
    ...input(twoProjectState()),
    projectId: "00000000-0000-4000-8000-000000000000",
  });
  assert.equal(detail, null);
});
