export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type ProjectControlState = "enabled" | "paused" | "disabled";

export type RunnerState = "online" | "offline" | "draining" | "disabled";

export type ExecutionStatus =
  | "queued"
  | "leased"
  | "dispatched"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";

export type ProviderQuotaPolicyState =
  | "normal"
  | "throttled"
  | "draining"
  | "blocked"
  | "unknown";

export type ControlCommandSource = "dashboard" | "github" | "system";

export type ControlCommandStatus =
  | "received"
  | "authorized"
  | "rejected"
  | "applied"
  | "failed";

export interface ProjectRecord {
  id: string;
  slug: string;
  name: string;
  repositoryOwner: string;
  repositoryName: string;
  repositoryId: string | null;
  state: ProjectControlState;
  priority: number;
  adeAdapter: string;
  runnerPolicy: JsonObject;
  configuration: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSnapshotRecord {
  id: string;
  projectId: string;
  adeRunId: string | null;
  status: string;
  stage: string | null;
  milestone: string | null;
  currentWorkRef: string | null;
  currentWorkSummary: string | null;
  nextWorkRef: string | null;
  nextWorkSummary: string | null;
  waitingReason: string | null;
  requiresHuman: boolean;
  observedAt: string;
  expiresAt: string | null;
}

export interface RunnerRecord {
  id: string;
  name: string;
  kind: string;
  state: RunnerState;
  architecture: string;
  capabilities: JsonObject;
  labels: readonly string[];
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionRecord {
  id: string;
  projectId: string;
  runnerId: string | null;
  adeExecutionRef: string | null;
  workRef: string | null;
  capability: string;
  status: ExecutionStatus;
  attempt: number;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  resultSummary: JsonObject | null;
  errorCode: string | null;
  errorSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionLeaseRecord {
  id: string;
  executionId: string;
  projectId: string;
  runnerId: string | null;
  ownerId: string;
  leaseKey: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  releasedAt: string | null;
  releaseReason: string | null;
}

export interface ProviderQuotaSnapshotRecord {
  id: string;
  provider: string;
  accountRef: string;
  policyState: ProviderQuotaPolicyState;
  usedPercent: number | null;
  windowDurationMins: number | null;
  windowStartedAt: string | null;
  resetsAt: string | null;
  observedAt: string;
  expiresAt: string | null;
  metadata: JsonObject;
}

export interface ControlCommandRecord {
  id: string;
  source: ControlCommandSource;
  actorType: string;
  actorRef: string;
  projectId: string | null;
  commandType: string;
  payload: JsonValue;
  idempotencyKey: string | null;
  status: ControlCommandStatus;
  receivedAt: string;
  appliedAt: string | null;
  resultSummary: JsonObject | null;
}

export interface AuditEventRecord {
  id: string;
  occurredAt: string;
  category: string;
  severity: string;
  actorType: string;
  actorRef: string | null;
  projectId: string | null;
  executionId: string | null;
  runnerId: string | null;
  action: string;
  reason: string | null;
  result: string | null;
  correlationId: string | null;
  metadata: JsonObject;
}

export interface ScheduledExecutionRecord {
  execution: ExecutionRecord;
  lease: ExecutionLeaseRecord;
}

export interface ReconciliationCandidate {
  execution: ExecutionRecord;
  lease: ExecutionLeaseRecord | null;
  reason: "stale-lease" | "unknown-execution";
}

export interface CompletionResult {
  execution: ExecutionRecord;
  applied: boolean;
  releasedLease: boolean;
}

export type SchedulerMode = "running" | "paused" | "safe_mode";

export interface ControlPlaneSettingsRecord {
  schedulerMode: SchedulerMode;
  quotaThrottledPercent: number;
  quotaDrainingPercent: number;
  quotaBlockedPercent: number;
  quotaStaleAfterMs: number;
  updatedAt: string;
  updatedBy: string | null;
}

export type GithubDeliveryStatus = "received" | "rejected" | "ignored" | "processed";

/**
 * A validated, GitHub-derived scheduling projection. The original issue body
 * never enters this model: only the strict `ade.github-work/v1` fields do.
 */
export type GithubWorkItemState =
  | "ready"
  | "running"
  | "waiting-human"
  | "blocked"
  | "completed"
  | "failed";

export type GithubWorkRetryPolicy = "safe" | "reconcile-first" | "never";

export type GithubWorkProfileReason =
  | "compatible"
  | "missing-profile"
  | "invalid-profile"
  | "unsupported-profile";
export type AdeProjectCompatibilityState =
  | "setup-required"
  | "validating"
  | "compatible"
  | "invalid"
  | "upgrade-required"
  | "incompatible";

export interface GithubWorkProfileRecord {
  projectId: string;
  repositoryGithubId: string;
  compatible: boolean;
  contractVersion: string | null;
  capabilities: readonly string[];
  skillPaths: readonly string[];
  reason: GithubWorkProfileReason;
  observedAt: string;
  adeStatus?: AdeProjectCompatibilityState;
  adeConfigVersion?: string | null;
  adeRuntimeVersion?: string | null;
  resolvedProfiles?: readonly string[];
  resolvedRules?: readonly string[];
  contextStatus?: "fresh" | "stale" | "missing" | "unknown";
}

export interface GithubWorkItemRecord {
  id: string;
  projectId: string;
  repositoryGithubId: string;
  contractVersion: string;
  issueNumber: number;
  issueUrl: string;
  state: GithubWorkItemState;
  priority: number;
  dependsOn: readonly number[];
  retryPolicy: GithubWorkRetryPolicy;
  humanDecisionRef: string | null;
  executionRef: string | null;
  branchName: string | null;
  pullRequestNumber: number | null;
  sourceUpdatedAt: string;
  observedAt: string;
  expiresAt: string;
  /** False only after a full successful reconciliation no longer saw it. */
  present: boolean;
}

export type GithubSubjectType = "issue" | "pull_request";

export type BotCommentPurpose = "status" | "waiting-human" | "failure";

export type AdeDecisionStatus = "open" | "resolved" | "cancelled";

export interface GithubDeliveryRecord {
  id: string;
  deliveryId: string;
  event: string;
  action: string;
  repositoryGithubId: string;
  projectId: string | null;
  actorRef: string | null;
  subjectType: GithubSubjectType | null;
  subjectNumber: number | null;
  commentId: string | null;
  status: GithubDeliveryStatus;
  rejectionCode: string | null;
  controlCommandId: string | null;
  receivedAt: string;
  processedAt: string | null;
}

export interface GithubBotCommentRecord {
  projectId: string;
  purpose: BotCommentPurpose;
  subjectType: GithubSubjectType;
  subjectNumber: number;
  commentId: string;
  updatedAt: string;
}

export type AgentUsageCostKind =
  | "provider_reported"
  | "api_pricing_estimate"
  | "subscription_included"
  | "credit_consumption"
  | "unknown";

export interface AgentUsageMetrics {
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
  providerDurationMs?: number;
  providerApiDurationMs?: number;
  turnCount?: number;
  costAmount?: number;
  costCurrency?: string;
  costKind?: AgentUsageCostKind;
  usageSource?: string;
  providerExecutionRef?: string;
  model?: string;
}

export interface AgentUsageRecord extends AgentUsageMetrics {
  id: string;
  executionId: string | null;
  taskId: string | null;
  projectId: string;
  githubIssueNumber: number | null;
  githubPullRequestNumber: number | null;
  provider: string;
  startedAt: string;
  finishedAt: string | null;
  wallDurationMs: number | null;
  observedAt: string;
  costKind: AgentUsageCostKind;
  usageSource: string;
}

export interface AdeDecisionRecord {
  id: string;
  projectId: string;
  decisionRef: string;
  prompt: string;
  options: readonly string[];
  status: AdeDecisionStatus;
  resolvedOption: string | null;
  resolvedBy: string | null;
  observedAt: string;
  resolvedAt: string | null;
}

export type V0TaskStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "CANCELLED";
export type V0TaskSource =
  | { type: "prompt"; prompt: string }
  | { type: "github-issue"; issueNumber: number };
export type V0TaskLogStream = "system" | "stdout" | "stderr";

export interface V0TaskRecord {
  id: string;
  projectId: string;
  source: V0TaskSource;
  prompt: string;
  status: V0TaskStatus;
  cancelRequested: boolean;
  branchName: string | null;
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  errorCode: string | null;
  errorSummary: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface V0TaskLogRecord {
  id: string;
  taskId: string;
  occurredAt: string;
  stream: V0TaskLogStream;
  message: string;
}
