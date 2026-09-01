import {
  evaluateSchedule,
  selectGithubWork,
  type AdeAvailability,
  type CandidateExplanation,
  type DetailedSchedulerDecision,
  type ExclusionCode,
  type SchedulerCandidate,
  type SchedulerMode,
  type SchedulerRunner,
  type GithubWorkSelection,
} from "@ade-control-plane/core";
import type {
  AdeDecisionRecord,
  AuditEventRecord,
  ControlCommandRecord,
  ControlPlanePersistence,
  ExecutionRecord,
  ProjectRecord,
  GithubWorkItemRecord,
  GithubWorkProfileRecord,
  AdeProjectCompatibilityState,
  ProviderQuotaSnapshotRecord,
  RunnerRecord,
} from "@ade-control-plane/database";
import { evaluateQuota, type QuotaDecision } from "@ade-control-plane/quota";

import { classifyRetryability, type Retryability } from "./retry.js";
import { sanitizeText } from "./sanitize.js";

/**
 * User-facing status vocabulary from `docs/DASHBOARD.md`.
 * `unknown` and `reconciling` are first-class: they must never be rendered as
 * a silent idle or a plain failure.
 */
export type ProjectStatus =
  | "running"
  | "ready"
  | "waiting-human"
  | "waiting-quota"
  | "waiting-runner"
  | "paused"
  | "failed"
  | "reconciling"
  | "completed"
  | "unknown";

export interface QuotaView {
  provider: string;
  accountRef: string;
  state: QuotaDecision["state"];
  usedPercent: number | null;
  windowDurationMins: number | null;
  resetsAt: string | null;
  observedAt: string | null;
  snapshotAgeMs: number | null;
  reason: string;
  refreshRequired: boolean;
}

export interface RunnerView {
  id: string;
  name: string;
  state: RunnerRecord["state"];
  architecture: string;
  capabilities: readonly string[];
  labels: readonly string[];
  lastHeartbeatAt: string | null;
  heartbeatAgeMs: number | null;
  healthy: boolean;
  activeExecutionCount: number;
}

export interface ExecutionView {
  id: string;
  projectId: string;
  projectName: string;
  runnerId: string | null;
  status: ExecutionRecord["status"];
  capability: string;
  workRef: string | null;
  attempt: number;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  errorSummary: string | null;
  retryability: Retryability;
}

export interface ProjectView {
  id: string;
  slug: string;
  name: string;
  repositoryUrl: string;
  controlState: ProjectRecord["state"];
  adeStatus: AdeProjectCompatibilityState;
  adeRuntimeVersion: string;
  adeConfigVersion: string | null;
  resolvedProfiles: readonly string[];
  resolvedRules: readonly string[];
  contextStatus: "fresh" | "stale" | "missing" | "unknown";
  priority: number;
  status: ProjectStatus;
  waitingReason: string | null;
  exclusion: ExclusionCode | null;
  stage: string | null;
  milestone: string | null;
  currentWorkSummary: string | null;
  nextWorkSummary: string | null;
  snapshotObservedAt: string | null;
  snapshotAgeMs: number | null;
  snapshotFresh: boolean;
  requiresHuman: boolean;
  activeRunnerId: string | null;
  lastSuccessfulExecutionAt: string | null;
  compatibleRunnerIds: readonly string[];
}

export interface AttentionItem {
  key: string;
  projectId: string | null;
  title: string;
  reason: string;
  since: string;
  recommendedAction: string;
  href: string | null;
}

export interface TimelineEntry {
  id: string;
  occurredAt: string;
  kind: "execution" | "audit" | "command";
  title: string;
  detail: string | null;
  severity: "info" | "warning" | "error";
}

export interface OverviewViewModel {
  generatedAt: string;
  adeRuntimeVersion: string;
  schedulerMode: SchedulerMode;
  schedulerExplanation: string;
  nextWakeUpAt: string | null;
  quota: QuotaView;
  runners: readonly RunnerView[];
  runnerHealthSummary: string;
  workerHealth: WorkerHealthView;
  activeExecutions: readonly ExecutionView[];
  attention: readonly AttentionItem[];
  projects: readonly ProjectView[];
}

export type WorkerHealthStatus = "healthy" | "idle" | "waiting-quota" | "degraded-github" | "stale/unhealthy";

export interface WorkerHealthView {
  status: WorkerHealthStatus;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  lastSuccessfulCycleAt: string | null;
  lastGithubReconcileAt: string | null;
  nextWakeReason: string | null;
  nextWakeAt: string | null;
}

export interface DecisionView {
  decisionRef: string;
  prompt: string;
  options: readonly string[];
  observedAt: string;
  /** Exact GitHub syntax an authorized actor can paste on the issue or PR. */
  githubCommands: readonly string[];
}

export interface ProjectDetailViewModel {
  project: ProjectView;
  schedulerMode: SchedulerMode;
  executions: readonly ExecutionView[];
  timeline: readonly TimelineEntry[];
  humanDecisions: readonly AttentionItem[];
  openDecisions: readonly DecisionView[];
  availableActions: {
    canPause: boolean;
    canResume: boolean;
    canReprioritize: boolean;
    safeRetryExecutionId: string | null;
  };
}

export interface ReadModelInput {
  persistence: ControlPlanePersistence;
  quotaProvider: string;
  quotaAccountRef: string;
  now?: string;
  adeRuntimeVersion?: string;
}

const STALE_SNAPSHOT_MS = 300_000;
const STALE_HEARTBEAT_MS = 120_000;

export async function buildOverview(
  input: ReadModelInput,
): Promise<OverviewViewModel> {
  const now = input.now ?? new Date().toISOString();
  const { persistence } = input;
  const settings = await persistence.settings.get();
  const [projects, runners, activeExecutions] = await Promise.all([
    persistence.projects.list(),
    persistence.runners.list(),
    persistence.executions.listActive(),
  ]);
  const [workItems, profiles, histories, quotaSnapshot, recentAudits] = await Promise.all([
    persistence.githubWork.listForProjects(projects.map(({ id }) => id)),
    Promise.all(projects.map((project) => persistence.githubWork.getProfile(project.id))),
    Promise.all(projects.map((project) => persistence.executions.listByProjectId(project.id, 100))),
    persistence.providerQuotaSnapshots.getLatest(input.quotaProvider, input.quotaAccountRef),
    persistence.auditEvents.listRecent(100),
  ]);

  const quota = buildQuotaView(
    input.quotaProvider,
    input.quotaAccountRef,
    quotaSnapshot,
    settings,
    now,
  );
  const profileByProject = new Map(
    profiles.filter((profile): profile is GithubWorkProfileRecord => profile !== null)
      .map((profile) => [profile.projectId, profile]),
  );
  const workByProject = new Map<string, GithubWorkItemRecord[]>();
  for (const item of workItems) {
    const items = workByProject.get(item.projectId) ?? [];
    items.push(item);
    workByProject.set(item.projectId, items);
  }
  const selectionByProject = new Map(projects.map((project) => [
    project.id,
    selectProjectGithubWork(profileByProject.get(project.id) ?? null, workByProject.get(project.id) ?? [], now),
  ]));
  const activeByProject = new Map(
    activeExecutions.map((execution) => [execution.projectId, execution]),
  );
  const schedulerRunners = runners.map(toSchedulerRunner);
  const candidates = projects.map((project) =>
    toSchedulerCandidate(
      project,
      selectionByProject.get(project.id)!,
      activeByProject.has(project.id),
      histories[projects.indexOf(project)] ?? [],
    ),
  );
  const decision = evaluateSchedule({
    mode: settings.schedulerMode,
    now,
    quota: quota.resetsAt
      ? { state: quota.state, resetsAt: quota.resetsAt }
      : { state: quota.state },
    candidates,
    runners: schedulerRunners,
  });
  const explanationByProject = new Map(
    decision.candidates.map((explanation) => [explanation.projectId, explanation]),
  );
  const projectViews = projects.map((project) =>
    toProjectView(
      project,
      profileByProject.get(project.id) ?? null,
      selectionByProject.get(project.id)!,
      explanationByProject.get(project.id) ?? null,
      activeByProject.get(project.id) ?? null,
      now,
      input.adeRuntimeVersion,
    ),
  );
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const runnerViews = runners.map((runner) =>
    toRunnerView(runner, activeExecutions, now),
  );

  return {
    generatedAt: now,
    adeRuntimeVersion: input.adeRuntimeVersion ?? "unknown",
    schedulerMode: settings.schedulerMode,
    schedulerExplanation: explainSchedule(decision, settings.schedulerMode, projectViews),
    nextWakeUpAt: decision.nextWakeUpAt ?? null,
    quota,
    runners: runnerViews,
    runnerHealthSummary: summarizeRunners(runnerViews),
    workerHealth: buildWorkerHealth(runnerViews, recentAudits, now, decision.nextWakeUpAt ?? null, settings.schedulerMode, quota.state),
    activeExecutions: activeExecutions.map((execution) =>
      toExecutionView(execution, projectNames.get(execution.projectId) ?? execution.projectId),
    ),
    attention: buildAttentionQueue(projectViews, runnerViews, quota, now),
    projects: [...projectViews].sort(compareProjectViews),
  };
}

function buildWorkerHealth(
  runners: readonly RunnerView[],
  audits: readonly AuditEventRecord[],
  now: string,
  schedulerNextWakeAt: string | null,
  schedulerMode: SchedulerMode,
  quotaState: QuotaDecision["state"],
): WorkerHealthView {
  const workerAudits = audits.filter((event) => event.category === "worker");
  const started = [...workerAudits].reverse().find((event) => event.action === "worker.started") ?? null;
  const success = [...workerAudits].reverse().find((event) => event.action === "worker.cycle-succeeded") ?? null;
  const failure = [...workerAudits].reverse().find((event) => event.action === "worker.cycle-failed") ?? null;
  const lastHeartbeatAt = runners.map((runner) => runner.lastHeartbeatAt).filter((value): value is string => value !== null).sort().at(-1) ?? null;
  const unhealthy = runners.length === 0 || runners.every((runner) => !runner.healthy);
  const status: WorkerHealthStatus = unhealthy
    ? "stale/unhealthy"
    : failure && (!success || Date.parse(failure.occurredAt) > Date.parse(success.occurredAt))
      ? "degraded-github"
      : quotaState === "blocked"
        ? "waiting-quota"
        : schedulerMode !== "running" || success?.metadata.outcome === "idle"
          ? "idle"
          : success
            ? "healthy"
            : "stale/unhealthy";
  return {
    status,
    startedAt: started?.occurredAt ?? null,
    lastHeartbeatAt,
    lastSuccessfulCycleAt: success?.occurredAt ?? null,
    lastGithubReconcileAt: success?.occurredAt ?? null,
    nextWakeReason: success && typeof success.metadata.wakeReason === "string" ? success.metadata.wakeReason : null,
    nextWakeAt: success && typeof success.metadata.nextWakeAt === "string" ? success.metadata.nextWakeAt : schedulerNextWakeAt,
  };
}

export async function buildProjectDetail(
  input: ReadModelInput & { projectId: string },
): Promise<ProjectDetailViewModel | null> {
  const now = input.now ?? new Date().toISOString();
  const { persistence } = input;
  const project = await persistence.projects.getById(input.projectId);
  if (!project) return null;

  const overview = await buildOverview(input);
  const view =
    overview.projects.find(({ id }) => id === project.id) ??
    toProjectView(project, null, selectProjectGithubWork(null, [], now), null, null, now, input.adeRuntimeVersion);
  const [executions, auditEvents, commands, decisions] = await Promise.all([
    persistence.executions.listByProjectId(project.id, 20),
    persistence.auditEvents.listForProject(project.id, 30),
    persistence.controlCommands.listForProject(project.id, 20),
    persistence.adeDecisions.listOpenByProjectId(project.id),
  ]);
  const executionViews = executions.map((execution) =>
    toExecutionView(execution, project.name),
  );
  const safeRetry = executionViews.find(({ retryability }) => retryability === "safe");

  return {
    project: view,
    schedulerMode: overview.schedulerMode,
    executions: executionViews,
    timeline: buildTimeline(executionViews, auditEvents, commands),
    humanDecisions: overview.attention.filter(
      (item) => item.projectId === project.id && item.key.startsWith("human:"),
    ),
    openDecisions: decisions.map(toDecisionView),
    availableActions: {
      canPause: project.state === "enabled",
      canResume: project.state !== "enabled",
      canReprioritize: project.state !== "disabled",
      safeRetryExecutionId: safeRetry?.id ?? null,
    },
  };
}

/**
 * Only decisions ADE has actually exposed are shown, with only the options it
 * offered. Neither the Dashboard nor GitHub can invent a decision payload.
 */
function toDecisionView(decision: AdeDecisionRecord): DecisionView {
  return {
    decisionRef: decision.decisionRef,
    prompt: sanitizeText(decision.prompt),
    options: decision.options,
    observedAt: decision.observedAt,
    githubCommands: decision.options.map(
      (option) => `@ade decide ${decision.decisionRef} ${option}`,
    ),
  };
}

function buildQuotaView(
  provider: string,
  accountRef: string,
  snapshot: ProviderQuotaSnapshotRecord | null,
  settings: { quotaThrottledPercent: number; quotaDrainingPercent: number; quotaBlockedPercent: number; quotaStaleAfterMs: number },
  now: string,
): QuotaView {
  if (!snapshot) {
    return {
      provider,
      accountRef,
      state: "unknown",
      usedPercent: null,
      windowDurationMins: null,
      resetsAt: null,
      observedAt: null,
      snapshotAgeMs: null,
      reason: "No provider quota snapshot has been recorded yet.",
      refreshRequired: true,
    };
  }

  const decision = evaluateQuota(
    {
      provider: snapshot.provider,
      accountRef: snapshot.accountRef,
      usedPercent: snapshot.usedPercent,
      ...(snapshot.windowDurationMins !== null
        ? { windowDurationMins: snapshot.windowDurationMins }
        : {}),
      observedAt: snapshot.observedAt,
      ...(snapshot.expiresAt ? { expiresAt: snapshot.expiresAt } : {}),
      ...(snapshot.resetsAt ? { resetsAt: snapshot.resetsAt } : {}),
    },
    {
      throttledAtPercent: settings.quotaThrottledPercent,
      drainingAtPercent: settings.quotaDrainingPercent,
      blockedAtPercent: settings.quotaBlockedPercent,
      staleAfterMs: settings.quotaStaleAfterMs,
      allowStartWhenUnknown: false,
    },
    now,
  );

  return {
    provider: snapshot.provider,
    accountRef: snapshot.accountRef,
    state: decision.state,
    // Never fabricate a percentage the provider did not expose.
    usedPercent: snapshot.usedPercent,
    windowDurationMins: snapshot.windowDurationMins,
    resetsAt: decision.resetsAt ?? null,
    observedAt: snapshot.observedAt,
    snapshotAgeMs: ageMs(snapshot.observedAt, now),
    reason: decision.reason,
    refreshRequired: decision.refreshRequired,
  };
}

function toSchedulerRunner(runner: RunnerRecord): SchedulerRunner {
  const capabilities = runner.capabilities;
  return {
    id: runner.id,
    state: runner.state,
    architecture: runner.architecture,
    labels: runner.labels,
    capabilities: Object.entries(capabilities)
      .filter(([, enabled]) => enabled !== false && enabled !== null)
      .map(([capability]) => capability),
    memoryClass: readMemoryClass(capabilities.memoryClass),
  };
}

function readMemoryClass(value: unknown): "small" | "medium" | "large" {
  return value === "large" || value === "medium" ? value : "small";
}

function toSchedulerCandidate(
  project: ProjectRecord,
  selection: GithubWorkSelection,
  hasActiveLease: boolean,
  history: readonly ExecutionRecord[],
): SchedulerCandidate {
  const labels = Array.isArray(project.runnerPolicy.labels)
    ? project.runnerPolicy.labels.map(String)
    : [];

  return {
    project: {
      id: project.id,
      repository: `${project.repositoryOwner}/${project.repositoryName}`,
      priority: selection.item?.priority ?? project.priority,
      controlState: project.state,
      requiredRunnerLabels: labels,
    },
    adeAvailability: selection.availability,
    // GitHub work has no user-supplied cost field. Treat every Codex run as
    // long so quota draining cannot be bypassed by an inferred estimate.
    work: selection.availability === "ready" && selection.item
      ? { ref: githubWorkRef(selection.item.issueNumber), cost: "long" }
      : null,
    hasActiveLease,
    requiresReconciliation: selection.item !== null && history.some((execution) =>
      execution.workRef === githubWorkRef(selection.item!.issueNumber) &&
      ["succeeded", "failed", "cancelled", "unknown"].includes(execution.status) &&
      execution.resultSummary?.sourceUpdatedAt === selection.item!.sourceUpdatedAt,
    ),
  };
}

function selectProjectGithubWork(
  profile: GithubWorkProfileRecord | null,
  items: readonly GithubWorkItemRecord[],
  now: string,
): GithubWorkSelection {
  if (!profile || !profile.compatible) {
    return { availability: "unknown", item: null, reason: profile
      ? `GitHub work profile is ${profile.reason}.`
      : "GitHub work profile has not been reconciled yet." };
  }
  return selectGithubWork(items, now);
}

const EXCLUSION_STATUS: Readonly<Record<ExclusionCode, ProjectStatus>> = {
  "global-paused": "paused",
  "global-safe-mode": "paused",
  "project-paused": "paused",
  "project-disabled": "paused",
  "ade-not-ready": "unknown",
  "no-runnable-work": "completed",
  "waiting-human": "waiting-human",
  reconciling: "reconciling",
  "reconcile-first": "reconciling",
  "work-blocked": "reconciling",
  "work-completed": "completed",
  "work-failed": "failed",
  "security-blocked": "failed",
  "quota-blocked": "waiting-quota",
  "quota-unknown": "waiting-quota",
  "quota-throttled": "waiting-quota",
  "quota-draining": "waiting-quota",
  "lease-active": "running",
  "no-compatible-runner": "waiting-runner",
};

const EXCLUSION_REASON: Readonly<Record<ExclusionCode, string>> = {
  "global-paused": "Global scheduling is paused.",
  "global-safe-mode": "Safe mode blocks new privileged dispatch.",
  "project-paused": "Project is paused by an operator.",
  "project-disabled": "Project is disabled.",
  "ade-not-ready": "The GitHub work projection is stale or missing, so eligibility is unknown.",
  "no-runnable-work": "GitHub reports no runnable work.",
  "waiting-human": "GitHub work is waiting for a human decision.",
  reconciling: "The previous outcome is ambiguous and is being reconciled.",
  "reconcile-first": "This GitHub issue revision has already been attempted and must be reconciled before another run.",
  "work-blocked": "GitHub work is explicitly blocked.",
  "work-completed": "All GitHub work is completed.",
  "work-failed": "GitHub work is explicitly marked failed.",
  "security-blocked": "The project is blocked for security reasons.",
  "quota-blocked": "Provider quota is exhausted.",
  "quota-unknown": "Provider quota state is unknown, so scheduling stays conservative.",
  "quota-throttled": "Provider quota is throttled below this project's priority.",
  "quota-draining": "Provider quota is draining and long work is deferred.",
  "lease-active": "An execution is already running for this project.",
  "no-compatible-runner": "No online runner matches the required capabilities.",
};

function toProjectView(
  project: ProjectRecord,
  profile: GithubWorkProfileRecord | null,
  selection: GithubWorkSelection,
  explanation: CandidateExplanation | null,
  activeExecution: ExecutionRecord | null,
  now: string,
  adeRuntimeVersion = "unknown",
): ProjectView {
  const exclusion = explanation?.exclusion ?? null;
  const item = selection.item;
  const snapshotAgeMs = item ? ageMs(item.observedAt, now) : null;

  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    repositoryUrl: `https://github.com/${project.repositoryOwner}/${project.repositoryName}`,
    controlState: project.state,
    adeStatus: profile?.adeStatus ?? (!profile || profile.reason === "missing-profile" ? "setup-required" : "incompatible"),
    adeRuntimeVersion: profile?.adeRuntimeVersion ?? adeRuntimeVersion,
    adeConfigVersion: profile?.adeConfigVersion ?? null,
    resolvedProfiles: profile?.resolvedProfiles ?? [],
    resolvedRules: profile?.resolvedRules ?? [],
    contextStatus: profile?.contextStatus ?? "unknown",
    priority: project.priority,
    status: activeExecution
      ? "running"
      : exclusion
        ? EXCLUSION_STATUS[exclusion]
        : "ready",
    waitingReason: exclusion ? EXCLUSION_REASON[exclusion] : selection.reason,
    exclusion,
    stage: profile?.contractVersion ?? null,
    milestone: item ? `GitHub issue #${item.issueNumber}` : null,
    currentWorkSummary: item ? `GitHub issue #${item.issueNumber}` : null,
    nextWorkSummary: null,
    snapshotObservedAt: item?.observedAt ?? profile?.observedAt ?? null,
    snapshotAgeMs,
    snapshotFresh: item !== null && item !== undefined && Date.parse(item.expiresAt) > Date.parse(now),
    requiresHuman: selection.availability === "waiting_human",
    activeRunnerId: activeExecution?.runnerId ?? null,
    lastSuccessfulExecutionAt: null,
    compatibleRunnerIds: explanation?.compatibleRunnerIds ?? [],
  };
}

function githubWorkRef(issueNumber: number): string {
  return `github:issue:${issueNumber}`;
}

function toRunnerView(
  runner: RunnerRecord,
  activeExecutions: readonly ExecutionRecord[],
  now: string,
): RunnerView {
  const heartbeatAgeMs = runner.lastHeartbeatAt
    ? ageMs(runner.lastHeartbeatAt, now)
    : null;

  return {
    id: runner.id,
    name: runner.name,
    state: runner.state,
    architecture: runner.architecture,
    capabilities: Object.keys(runner.capabilities),
    labels: runner.labels,
    lastHeartbeatAt: runner.lastHeartbeatAt,
    heartbeatAgeMs,
    healthy:
      runner.state === "online" &&
      heartbeatAgeMs !== null &&
      heartbeatAgeMs < STALE_HEARTBEAT_MS,
    activeExecutionCount: activeExecutions.filter(
      ({ runnerId }) => runnerId === runner.id,
    ).length,
  };
}

function toExecutionView(
  execution: ExecutionRecord,
  projectName: string,
): ExecutionView {
  return {
    id: execution.id,
    projectId: execution.projectId,
    projectName,
    runnerId: execution.runnerId,
    status: execution.status,
    capability: execution.capability,
    workRef: execution.workRef,
    attempt: execution.attempt,
    requestedAt: execution.requestedAt,
    startedAt: execution.startedAt,
    finishedAt: execution.finishedAt,
    errorCode: execution.errorCode,
    // Runner/provider text never reaches the browser unredacted.
    errorSummary: execution.errorSummary
      ? sanitizeText(execution.errorSummary)
      : null,
    retryability: classifyRetryability(execution),
  };
}

function buildAttentionQueue(
  projects: readonly ProjectView[],
  runners: readonly RunnerView[],
  quota: QuotaView,
  now: string,
): readonly AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const project of projects) {
    if (project.status === "waiting-human") {
      items.push({
        key: `human:${project.id}`,
        projectId: project.id,
        title: `${project.name} is waiting for a human decision`,
        reason: project.waitingReason ?? "ADE requires a human decision.",
        since: project.snapshotObservedAt ?? now,
        recommendedAction: "Open the project and resolve the pending decision.",
        href: `/projects/${project.id}`,
      });
    }
    if (project.status === "reconciling" || project.status === "unknown") {
      items.push({
        key: `reconcile:${project.id}`,
        projectId: project.id,
        title: `${project.name} has an unresolved outcome`,
        reason:
          project.waitingReason ??
          "The control plane cannot confirm the last execution outcome.",
        since: project.snapshotObservedAt ?? now,
        recommendedAction: "Wait for reconciliation; do not retry from the Dashboard.",
        href: `/projects/${project.id}`,
      });
    }
    if (project.status === "failed") {
      items.push({
        key: `blocked:${project.id}`,
        projectId: project.id,
        title: `${project.name} is blocked`,
        reason: project.waitingReason ?? "The project is blocked.",
        since: project.snapshotObservedAt ?? now,
        recommendedAction: "Review the project timeline before resuming.",
        href: `/projects/${project.id}`,
      });
    }
  }

  for (const runner of runners) {
    if (!runner.healthy && runner.state !== "disabled") {
      items.push({
        key: `runner:${runner.id}`,
        projectId: null,
        title: `Runner ${runner.name} is not healthy`,
        reason:
          runner.lastHeartbeatAt === null
            ? "The runner has never sent a heartbeat."
            : "The last runner heartbeat is stale.",
        since: runner.lastHeartbeatAt ?? now,
        recommendedAction: "Check the runner host service before resuming dispatch.",
        href: "/runners",
      });
    }
  }

  if (quota.state === "unknown" || quota.state === "blocked") {
    items.push({
      key: `quota:${quota.provider}`,
      projectId: null,
      title: `Provider quota is ${quota.state}`,
      reason: quota.reason,
      since: quota.observedAt ?? now,
      recommendedAction:
        quota.state === "unknown"
          ? "Refresh the quota snapshot; scheduling stays conservative until then."
          : "Wait for the quota window to reset.",
      href: "/settings",
    });
  }

  return items;
}

function buildTimeline(
  executions: readonly ExecutionView[],
  auditEvents: readonly AuditEventRecord[],
  commands: readonly ControlCommandRecord[],
): readonly TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...executions.map((execution) => ({
      id: `execution:${execution.id}`,
      occurredAt: execution.finishedAt ?? execution.startedAt ?? execution.requestedAt,
      kind: "execution" as const,
      title: `Execution ${execution.status} (attempt ${execution.attempt})`,
      detail: execution.errorCode
        ? `${execution.errorCode}: ${execution.errorSummary ?? "no further detail"}`
        : execution.workRef,
      severity:
        execution.status === "failed"
          ? ("error" as const)
          : execution.status === "unknown"
            ? ("warning" as const)
            : ("info" as const),
    })),
    ...auditEvents.map((event) => ({
      id: `audit:${event.id}`,
      occurredAt: event.occurredAt,
      kind: "audit" as const,
      title: `${event.category}: ${event.action}`,
      detail: event.reason ? sanitizeText(event.reason) : null,
      severity: normalizeSeverity(event.severity),
    })),
    ...commands.map((command) => ({
      id: `command:${command.id}`,
      occurredAt: command.receivedAt,
      kind: "command" as const,
      title: `${command.commandType} (${command.status})`,
      detail: `Requested by ${command.actorRef} via ${command.source}.`,
      severity:
        command.status === "rejected" || command.status === "failed"
          ? ("warning" as const)
          : ("info" as const),
    })),
  ];

  return entries.sort(
    (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
  );
}

function normalizeSeverity(severity: string): "info" | "warning" | "error" {
  return severity === "error" || severity === "critical"
    ? "error"
    : severity === "warning"
      ? "warning"
      : "info";
}

/**
 * Explainability is a product feature: an idle control plane must always say
 * why nothing is running, per project.
 */
function explainSchedule(
  decision: DetailedSchedulerDecision,
  mode: SchedulerMode,
  projects: readonly ProjectView[],
): string {
  if (decision.selected) {
    const project = projects.find(({ id }) => id === decision.selected?.projectId);
    return `Next dispatch: ${project?.name ?? decision.selected.projectId} on runner ${decision.selected.runnerId} for ${decision.selected.workRef}.`;
  }
  if (mode !== "running") {
    return mode === "paused"
      ? "No work is dispatched: global scheduling is paused."
      : "No work is dispatched: safe mode is enabled.";
  }
  if (projects.length === 0) {
    return "No project is registered in the control plane yet.";
  }

  const reasons = projects
    .filter(({ exclusion }) => exclusion !== null)
    .map((project) => `${project.name}: ${project.waitingReason ?? "not eligible"}`);
  return reasons.length > 0
    ? `No project dispatched. ${reasons.join(" ")}`
    : decision.reason;
}

function summarizeRunners(runners: readonly RunnerView[]): string {
  if (runners.length === 0) return "No runner is registered.";

  const healthy = runners.filter(({ healthy: ok }) => ok).length;
  return healthy === runners.length
    ? `${healthy} runner(s) online with fresh heartbeats.`
    : `${healthy}/${runners.length} runner(s) healthy.`;
}

function compareProjectViews(left: ProjectView, right: ProjectView): number {
  const attentionDelta = attentionRank(right) - attentionRank(left);
  return (
    attentionDelta ||
    right.priority - left.priority ||
    left.name.localeCompare(right.name)
  );
}

function attentionRank(project: ProjectView): number {
  if (project.status === "waiting-human" || project.status === "failed") return 3;
  if (project.status === "reconciling" || project.status === "unknown") return 2;
  if (project.status === "running") return 1;
  return 0;
}

function nullableText(value: string | null | undefined): string | null {
  return value === null || value === undefined ? null : sanitizeText(value);
}

function ageMs(timestamp: string, now: string): number | null {
  const observed = Date.parse(timestamp);
  const current = Date.parse(now);
  if (Number.isNaN(observed) || Number.isNaN(current)) return null;
  return Math.max(0, current - observed);
}
