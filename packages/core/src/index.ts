export type ProjectId = string;

export type ProjectControlState = "enabled" | "paused" | "disabled";

export interface ManagedProject {
  id: ProjectId;
  repository: string;
  priority: number;
  controlState: ProjectControlState;
  requiredRunnerLabels?: readonly string[];
}

export type GlobalWaitingReason = "idle" | "quota" | "human" | "runner" | "paused";

export interface RunnableProjectCandidate {
  project: ManagedProject;
  hasRunnableWork: boolean;
  waitingReason?: GlobalWaitingReason;
  lastSuccessfulExecutionAt?: string;
}

export interface SchedulerDecision {
  selectedProjectId: ProjectId | null;
  reason: string;
  consideredProjectIds: readonly ProjectId[];
}

/** Compatibility selection used by the first worker cycle. */
export function selectNextProject(candidates: readonly RunnableProjectCandidate[]): SchedulerDecision {
  const eligible = candidates.filter(({ project, hasRunnableWork, waitingReason }) =>
    project.controlState === "enabled" && hasRunnableWork && waitingReason === undefined,
  ).toSorted(compareEligibleCandidates);
  const selected = eligible[0];
  if (!selected) return {
    selectedProjectId: null,
    reason: "No project satisfies control state, ADE runnable work, quota and runner gates.",
    consideredProjectIds: candidates.map(({ project }) => project.id),
  };
  return {
    selectedProjectId: selected.project.id,
    reason: `Selected ${selected.project.id}: highest eligible priority (${selected.project.priority}) with deterministic aging tie-break.`,
    consideredProjectIds: candidates.map(({ project }) => project.id),
  };
}

export type SchedulerMode = "running" | "paused" | "safe_mode";
export type RunnerState = "online" | "draining" | "offline" | "disabled";
export type WorkCost = "short" | "long";
export type MemoryClass = "small" | "medium" | "large";
export type AdeAvailability = "ready" | "unknown" | "stale" | "waiting_human" | "reconciling";
export type SchedulerQuotaState = "normal" | "throttled" | "draining" | "blocked" | "unknown";

export interface SchedulerRunner {
  id: string;
  state: RunnerState;
  architecture: string;
  labels: readonly string[];
  capabilities: readonly string[];
  memoryClass: MemoryClass;
}

export interface RunnerRequirements {
  architectures?: readonly string[];
  labels?: readonly string[];
  requiresDocker?: boolean;
  requiresBrowser?: boolean;
  minimumMemoryClass?: MemoryClass;
  requiredAdeCapabilities?: readonly string[];
}

export interface SchedulerWork {
  ref: string;
  cost: WorkCost;
  runnerRequirements?: RunnerRequirements;
}

export interface SchedulerCandidate {
  project: ManagedProject;
  adeAvailability: AdeAvailability;
  work: SchedulerWork | null;
  hasActiveLease: boolean;
  securityBlocked?: boolean;
  lastSuccessfulExecutionAt?: string;
}

export interface SchedulerQuota {
  state: SchedulerQuotaState;
  resetsAt?: string;
}

export interface SchedulerPolicy {
  minimumPriorityWhileThrottled: number;
  rejectLongWorkWhileDraining: boolean;
}

export const DEFAULT_SCHEDULER_POLICY: SchedulerPolicy = {
  minimumPriorityWhileThrottled: 50,
  rejectLongWorkWhileDraining: true,
};

export type ExclusionCode =
  | "global-paused" | "global-safe-mode" | "project-paused" | "project-disabled"
  | "ade-not-ready" | "no-runnable-work" | "waiting-human" | "reconciling"
  | "security-blocked" | "quota-blocked" | "quota-unknown" | "quota-throttled"
  | "quota-draining" | "lease-active" | "no-compatible-runner";

export interface CandidateExplanation {
  projectId: ProjectId;
  eligible: boolean;
  exclusion?: ExclusionCode;
  compatibleRunnerIds: readonly string[];
}

export interface ScheduleSelection {
  projectId: ProjectId;
  runnerId: string;
  workRef: string;
}

export interface DetailedSchedulerDecision {
  selected: ScheduleSelection | null;
  candidates: readonly CandidateExplanation[];
  reason: string;
  nextWakeUpAt?: string;
}

export interface ScheduleInput {
  mode: SchedulerMode;
  now: string;
  quota: SchedulerQuota;
  candidates: readonly SchedulerCandidate[];
  runners: readonly SchedulerRunner[];
  policy?: Partial<SchedulerPolicy>;
}

/**
 * Pure global scheduling. ADE-derived availability is supplied by the ADE
 * adapter; this function never reads or interprets ADE's delivery graph.
 */
export function evaluateSchedule(input: ScheduleInput): DetailedSchedulerDecision {
  const policy = { ...DEFAULT_SCHEDULER_POLICY, ...input.policy };
  const globalExclusion = modeExclusion(input.mode);
  const explanations = input.candidates.map((candidate) =>
    explainCandidate(candidate, input.runners, input.quota, globalExclusion, policy),
  );
  const eligible = input.candidates.map((candidate, index) => ({
    candidate,
    explanation: explanations[index]!,
  })).filter(({ explanation }) => explanation.eligible).toSorted(({ candidate: left }, { candidate: right }) =>
    compareSchedulerCandidates(left, right),
  );
  const selected = eligible[0];

  if (selected) return {
    selected: {
      projectId: selected.candidate.project.id,
      runnerId: selected.explanation.compatibleRunnerIds[0]!,
      workRef: selected.candidate.work!.ref,
    },
    candidates: explanations,
    reason: "Selected the highest-priority eligible project with deterministic aging and runner matching.",
  };

  const nextWakeUpAt = nextWakeUp(input);
  return {
    selected: null,
    candidates: explanations,
    reason: globalExclusion
      ? "Global scheduler mode prevents new privileged dispatch."
      : "No candidate passed all scheduler gates.",
    ...(nextWakeUpAt ? { nextWakeUpAt } : {}),
  };
}

function compareEligibleCandidates(left: RunnableProjectCandidate, right: RunnableProjectCandidate): number {
  const priorityDelta = right.project.priority - left.project.priority;
  return priorityDelta || compareAgingAndId(
    left.lastSuccessfulExecutionAt, right.lastSuccessfulExecutionAt, left.project.id, right.project.id,
  );
}

function compareSchedulerCandidates(left: SchedulerCandidate, right: SchedulerCandidate): number {
  const priorityDelta = right.project.priority - left.project.priority;
  return priorityDelta || compareAgingAndId(
    left.lastSuccessfulExecutionAt, right.lastSuccessfulExecutionAt, left.project.id, right.project.id,
  );
}

function compareAgingAndId(leftLastRun: string | undefined, rightLastRun: string | undefined, leftId: string, rightId: string): number {
  const ageDelta = parseRunTime(leftLastRun) - parseRunTime(rightLastRun);
  return ageDelta || leftId.localeCompare(rightId);
}

function parseRunTime(value: string | undefined): number {
  const timestamp = value === undefined ? 0 : Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function modeExclusion(mode: SchedulerMode): ExclusionCode | undefined {
  if (mode === "paused") return "global-paused";
  if (mode === "safe_mode") return "global-safe-mode";
  return undefined;
}

function explainCandidate(candidate: SchedulerCandidate, runners: readonly SchedulerRunner[], quota: SchedulerQuota, globalExclusion: ExclusionCode | undefined, policy: SchedulerPolicy): CandidateExplanation {
  const compatibleRunnerIds = compatibleRunners(candidate, runners);
  const exclusion = candidateExclusion(candidate, quota, globalExclusion, policy, compatibleRunnerIds);
  return { projectId: candidate.project.id, eligible: exclusion === undefined, ...(exclusion ? { exclusion } : {}), compatibleRunnerIds };
}

function candidateExclusion(candidate: SchedulerCandidate, quota: SchedulerQuota, globalExclusion: ExclusionCode | undefined, policy: SchedulerPolicy, compatibleRunnerIds: readonly string[]): ExclusionCode | undefined {
  if (globalExclusion) return globalExclusion;
  if (candidate.project.controlState === "paused") return "project-paused";
  if (candidate.project.controlState === "disabled") return "project-disabled";
  if (candidate.securityBlocked) return "security-blocked";
  if (candidate.adeAvailability === "waiting_human") return "waiting-human";
  if (candidate.adeAvailability === "reconciling") return "reconciling";
  if (candidate.adeAvailability !== "ready") return "ade-not-ready";
  if (!candidate.work) return "no-runnable-work";
  if (candidate.hasActiveLease) return "lease-active";
  if (quota.state === "blocked") return "quota-blocked";
  if (quota.state === "unknown") return "quota-unknown";
  if (quota.state === "throttled" && candidate.project.priority < policy.minimumPriorityWhileThrottled) return "quota-throttled";
  if (quota.state === "draining" && policy.rejectLongWorkWhileDraining && candidate.work.cost === "long") return "quota-draining";
  if (compatibleRunnerIds.length === 0) return "no-compatible-runner";
  return undefined;
}

function compatibleRunners(candidate: SchedulerCandidate, runners: readonly SchedulerRunner[]): readonly string[] {
  if (!candidate.work) return [];
  const requirements = candidate.work.runnerRequirements;
  const labels = [...(candidate.project.requiredRunnerLabels ?? []), ...(requirements?.labels ?? [])];
  return runners.filter((runner) => runner.state === "online")
    .filter((runner) => requirements?.architectures === undefined || requirements.architectures.includes(runner.architecture))
    .filter((runner) => labels.every((label) => runner.labels.includes(label)))
    .filter((runner) => !requirements?.requiresDocker || runner.capabilities.includes("docker"))
    .filter((runner) => !requirements?.requiresBrowser || runner.capabilities.includes("browser"))
    .filter((runner) => requirements?.requiredAdeCapabilities?.every((capability) => runner.capabilities.includes(`ade:${capability}`)) ?? true)
    .filter((runner) => requirements?.minimumMemoryClass === undefined || memoryRank(runner.memoryClass) >= memoryRank(requirements.minimumMemoryClass))
    .map((runner) => runner.id).toSorted();
}

function memoryRank(memoryClass: MemoryClass): number {
  return ["small", "medium", "large"].indexOf(memoryClass);
}

function nextWakeUp(input: ScheduleInput): string | undefined {
  if (input.quota.state !== "blocked" && input.quota.state !== "unknown") return undefined;
  if (input.quota.resetsAt === undefined || Number.isNaN(Date.parse(input.quota.resetsAt))) return undefined;
  return input.quota.resetsAt;
}
