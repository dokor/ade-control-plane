import type {
  ExecutionRecord,
  ProjectRecord,
  ProjectSnapshotRecord,
  ProviderQuotaSnapshotRecord,
  RunnerRecord,
} from "@ade-control-plane/database";

export const NOW = "2026-08-27T10:00:00.000Z";

export function project(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "argos",
    name: "Argos",
    repositoryOwner: "dokor",
    repositoryName: "argos",
    repositoryId: null,
    state: "enabled",
    priority: 80,
    adeAdapter: "local-process",
    runnerPolicy: {},
    configuration: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function snapshot(
  overrides: Partial<ProjectSnapshotRecord> = {},
): ProjectSnapshotRecord {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    projectId: "11111111-1111-4111-8111-111111111111",
    adeRunId: null,
    status: "ready",
    stage: "delivery",
    milestone: "M2",
    currentWorkRef: "work-1",
    currentWorkSummary: "Implement the control API",
    nextWorkRef: null,
    nextWorkSummary: null,
    waitingReason: null,
    requiresHuman: false,
    observedAt: NOW,
    expiresAt: null,
    ...overrides,
  };
}

export function runner(overrides: Partial<RunnerRecord> = {}): RunnerRecord {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    name: "raspberry-local",
    kind: "host",
    state: "online",
    architecture: "arm64",
    capabilities: { docker: true, memoryClass: "medium" },
    labels: [],
    lastHeartbeatAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function execution(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    projectId: "11111111-1111-4111-8111-111111111111",
    runnerId: "33333333-3333-4333-8333-333333333333",
    adeExecutionRef: null,
    workRef: "work-1",
    capability: "ade.advance",
    status: "failed",
    attempt: 1,
    requestedAt: NOW,
    startedAt: NOW,
    finishedAt: NOW,
    resultSummary: null,
    errorCode: "RUNNER_UNAVAILABLE",
    errorSummary: "Runner socket was unavailable.",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function quotaSnapshot(
  overrides: Partial<ProviderQuotaSnapshotRecord> = {},
): ProviderQuotaSnapshotRecord {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    provider: "openai",
    accountRef: "codex-account-main",
    policyState: "normal",
    usedPercent: 12,
    windowDurationMins: null,
    windowStartedAt: null,
    resetsAt: "2026-08-27T11:00:00.000Z",
    observedAt: NOW,
    expiresAt: null,
    metadata: {},
    ...overrides,
  };
}
