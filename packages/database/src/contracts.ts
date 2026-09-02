import type {
  AdeDeliveryStageTransitionRecord,
  AdeDeliveryWorkflowRecord,
  AdeDeliveryWorkflowStage,
  AdeDecisionRecord,
  AdeDecisionStatus,
  AuditEventRecord,
  BotCommentPurpose,
  ControlPlaneSettingsRecord,
  GithubBotCommentRecord,
  GithubDeliveryRecord,
  GithubDeliveryStatus,
  GithubWorkItemRecord,
  GithubWorkItemState,
  GithubWorkProfileReason,
  GithubWorkProfileRecord,
  AdeProjectCompatibilityState,
  GithubWorkRetryPolicy,
  GithubSubjectType,
  CompletionResult,
  ControlCommandRecord,
  ControlCommandSource,
  ControlCommandStatus,
  ExecutionLeaseRecord,
  ExecutionRecord,
  ExecutionStatus,
  JsonObject,
  JsonValue,
  ProjectControlState,
  ProjectDeletionRequestRecord,
  ProjectRecord,
  ProjectSnapshotRecord,
  ProviderQuotaPolicyState,
  ProviderQuotaSnapshotRecord,
  ReconciliationCandidate,
  RunnerRecord,
  RunnerState,
  ScheduledExecutionRecord,
  SchedulerMode,
  V0TaskLogRecord,
  V0TaskLogStream,
  V0TaskRecord,
  V0TaskSource,
  V0TaskStatus,
  AgentUsageCostKind,
  AgentUsageMetrics,
  AgentUsageRecord,
} from "./domain.js";

export interface AdeDeliveryWorkflowStartInput {
  id?: string;
  executionId: string;
  projectId: string;
  issueNumber: number;
  sourceUpdatedAt: string;
  occurredAt: string;
  adePlan?: JsonObject | null;
  provenance?: JsonObject | null;
  branchName?: string | null;
}

export interface AdeDeliveryWorkflowTransitionInput {
  workflowId: string;
  expectedStage?: AdeDeliveryWorkflowStage;
  stage: AdeDeliveryWorkflowStage;
  attempt: number;
  reason: string;
  idempotencyKey: string;
  occurredAt: string;
  details?: JsonObject | null;
  adePlan?: JsonObject | null;
  provenance?: JsonObject | null;
  providerExecutionRef?: string | null;
  validationSummary?: JsonObject | null;
  reviewSummary?: JsonObject | null;
  branchName?: string | null;
  headSha?: string | null;
  pullRequestNumber?: number | null;
  pullRequestUrl?: string | null;
  retryClassification?: string | null;
  reconciliationRequired?: boolean;
  humanDecisionRef?: string | null;
}

export interface ProjectRegistrationInput {
  id?: string;
  slug: string;
  name: string;
  repositoryOwner: string;
  repositoryName: string;
  repositoryId?: string | null;
  state?: ProjectControlState;
  priority: number;
  adeAdapter: string;
  runnerPolicy?: JsonObject;
  configuration?: JsonObject;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectSnapshotInput {
  id?: string;
  projectId: string;
  adeRunId?: string | null;
  status: string;
  stage?: string | null;
  milestone?: string | null;
  currentWorkRef?: string | null;
  currentWorkSummary?: string | null;
  nextWorkRef?: string | null;
  nextWorkSummary?: string | null;
  waitingReason?: string | null;
  requiresHuman?: boolean;
  observedAt: string;
  expiresAt?: string | null;
}

export interface RunnerRegistrationInput {
  id?: string;
  name: string;
  kind: string;
  state?: RunnerState;
  architecture: string;
  capabilities?: JsonObject;
  labels?: readonly string[];
  lastHeartbeatAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExecutionIntentInput {
  id?: string;
  projectId: string;
  runnerId?: string | null;
  adeExecutionRef?: string | null;
  workRef?: string | null;
  capability: string;
  attempt?: number;
  requestedAt: string;
}

export interface LeaseAcquisitionInput {
  id?: string;
  projectId: string;
  runnerId?: string | null;
  ownerId: string;
  leaseKey: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
}

export interface ScheduleExecutionWithLeaseInput {
  execution: ExecutionIntentInput;
  lease: LeaseAcquisitionInput;
}

export interface ExecutionCompletionInput {
  executionId: string;
  status: Extract<ExecutionStatus, "succeeded" | "failed" | "cancelled" | "unknown">;
  finishedAt: string;
  resultSummary?: JsonObject | null;
  errorCode?: string | null;
  errorSummary?: string | null;
  releaseReason: string;
  auditEvent?: AuditEventInput;
}

export interface ControlCommandReceiptInput {
  id?: string;
  source: ControlCommandSource;
  actorType: string;
  actorRef: string;
  projectId?: string | null;
  commandType: string;
  payload: JsonValue;
  idempotencyKey?: string | null;
  receivedAt: string;
}

export interface ControlCommandStatusUpdate {
  status: Extract<ControlCommandStatus, "authorized" | "rejected" | "applied" | "failed">;
  appliedAt?: string | null;
  resultSummary?: JsonObject | null;
}

export interface ProviderQuotaSnapshotInput {
  id?: string;
  provider: string;
  accountRef: string;
  policyState: ProviderQuotaPolicyState;
  usedPercent?: number | null;
  windowDurationMins?: number | null;
  windowStartedAt?: string | null;
  resetsAt?: string | null;
  observedAt: string;
  expiresAt?: string | null;
  metadata?: JsonObject;
}

export interface AuditEventInput {
  id?: string;
  occurredAt: string;
  category: string;
  severity: string;
  actorType: string;
  actorRef?: string | null;
  projectId?: string | null;
  executionId?: string | null;
  runnerId?: string | null;
  action: string;
  reason?: string | null;
  result?: string | null;
  correlationId?: string | null;
  metadata?: JsonObject;
}

export interface ControlPlaneSettingsUpdate {
  schedulerMode?: SchedulerMode;
  quotaThrottledPercent?: number;
  quotaDrainingPercent?: number;
  quotaBlockedPercent?: number;
  quotaStaleAfterMs?: number;
  updatedAt: string;
  updatedBy: string;
}

export interface ControlPlaneSettingsRepository {
  get(): Promise<ControlPlaneSettingsRecord>;
  update(update: ControlPlaneSettingsUpdate): Promise<ControlPlaneSettingsRecord>;
}

export interface GithubDeliveryReceiptInput {
  id?: string;
  deliveryId: string;
  event: string;
  action: string;
  repositoryGithubId: string;
  projectId?: string | null;
  actorRef?: string | null;
  subjectType?: GithubSubjectType | null;
  subjectNumber?: number | null;
  commentId?: string | null;
  receivedAt: string;
}

export interface GithubDeliveryOutcome {
  status: Extract<GithubDeliveryStatus, "rejected" | "ignored" | "processed">;
  rejectionCode?: string | null;
  controlCommandId?: string | null;
  processedAt?: string | null;
}

export interface GithubDeliveryReceipt {
  record: GithubDeliveryRecord;
  /** True when this delivery ID had already been recorded. */
  duplicate: boolean;
}

export interface GithubDeliveryRepository {
  getByDeliveryId(deliveryId: string): Promise<GithubDeliveryRecord | null>;
  /** Insert-or-detect: a replayed delivery ID never produces a second effect. */
  recordReceipt(input: GithubDeliveryReceiptInput): Promise<GithubDeliveryReceipt>;
  updateOutcome(
    id: string,
    outcome: GithubDeliveryOutcome,
  ): Promise<GithubDeliveryRecord>;
  listRecent(limit: number): Promise<readonly GithubDeliveryRecord[]>;
}

export interface GithubWorkProfileInput {
  projectId: string;
  repositoryGithubId: string;
  compatible: boolean;
  contractVersion?: string | null;
  capabilities?: readonly string[];
  skillPaths?: readonly string[];
  reason: GithubWorkProfileReason;
  observedAt: string;
  adeStatus?: AdeProjectCompatibilityState;
  adeConfigVersion?: string | null;
  adeRuntimeVersion?: string | null;
  resolvedProfiles?: readonly string[];
  resolvedRules?: readonly string[];
  contextStatus?: "fresh" | "stale" | "missing" | "unknown";
  missingRequiredCapabilityIds?: readonly string[];
  runnerCheckoutRef?: string | null;
}

export interface GithubWorkItemInput {
  projectId: string;
  repositoryGithubId: string;
  contractVersion: string;
  issueNumber: number;
  issueUrl: string;
  state: GithubWorkItemState;
  priority: number;
  dependsOn: readonly number[];
  retryPolicy: GithubWorkRetryPolicy;
  humanDecisionRef?: string | null;
  executionRef?: string | null;
  branchName?: string | null;
  pullRequestNumber?: number | null;
  sourceUpdatedAt: string;
  observedAt: string;
  expiresAt: string;
}

export interface GithubWorkReconciliationInput {
  profile: GithubWorkProfileInput;
  items: readonly GithubWorkItemInput[];
}

/**
 * Durable control-plane cache of the validated GitHub-first work contract.
 * Reconciliation replaces presence atomically; it does not copy issue prose.
 */
export interface GithubWorkRepository {
  getProfile(projectId: string): Promise<GithubWorkProfileRecord | null>;
  listForProject(projectId: string): Promise<readonly GithubWorkItemRecord[]>;
  listForProjects(projectIds: readonly string[]): Promise<readonly GithubWorkItemRecord[]>;
  reconcile(input: GithubWorkReconciliationInput): Promise<readonly GithubWorkItemRecord[]>;
  recordAdeReadiness(input: {
    projectId: string;
    status: AdeProjectCompatibilityState;
    configVersion?: string | null;
    runtimeVersion?: string | null;
    resolvedProfiles?: readonly string[];
    resolvedRules?: readonly string[];
    contextStatus?: "fresh" | "stale" | "missing" | "unknown";
    missingRequiredCapabilityIds?: readonly string[];
    runnerCheckoutRef?: string | null;
    observedAt: string;
  }): Promise<GithubWorkProfileRecord | null>;
}

export interface GithubBotCommentRepository {
  find(
    projectId: string,
    purpose: BotCommentPurpose,
    subjectType: GithubSubjectType,
    subjectNumber: number,
  ): Promise<GithubBotCommentRecord | null>;
  remember(record: GithubBotCommentRecord): Promise<GithubBotCommentRecord>;
}

export interface AdeDecisionInput {
  id?: string;
  projectId: string;
  decisionRef: string;
  prompt: string;
  options: readonly string[];
  status?: AdeDecisionStatus;
  observedAt: string;
}

export interface AdeDecisionRepository {
  getByRef(projectId: string, decisionRef: string): Promise<AdeDecisionRecord | null>;
  listOpenByProjectId(projectId: string): Promise<readonly AdeDecisionRecord[]>;
  upsert(input: AdeDecisionInput): Promise<AdeDecisionRecord>;
  /** Resolves only an open decision; a replayed resolution returns null. */
  resolve(
    projectId: string,
    decisionRef: string,
    option: string,
    resolvedBy: string,
    resolvedAt: string,
  ): Promise<AdeDecisionRecord | null>;
}

export interface V0TaskCreateInput {
  id?: string;
  projectId: string;
  prompt: string;
  source?: V0TaskSource;
  createdAt: string;
}

export interface V0TaskTransitionInput {
  taskId: string;
  status: Extract<V0TaskStatus, "SUCCESS" | "FAILED" | "CANCELLED">;
  finishedAt: string;
  branchName?: string | null;
  headSha?: string | null;
  pullRequestNumber?: number | null;
  pullRequestUrl?: string | null;
  adeProvenance?: JsonObject | null;
  errorCode?: string | null;
  errorSummary?: string | null;
}

export interface V0TaskPushedInput {
  taskId: string;
  branchName: string;
  headSha: string;
}

export interface V0TaskLogInput {
  taskId: string;
  occurredAt: string;
  stream: V0TaskLogStream;
  message: string;
}

export interface V0TaskRepository {
  create(input: V0TaskCreateInput): Promise<V0TaskRecord>;
  getById(taskId: string): Promise<V0TaskRecord | null>;
  list(limit: number): Promise<readonly V0TaskRecord[]>;
  claimPending(startedAt: string): Promise<V0TaskRecord | null>;
  requestCancel(taskId: string, requestedAt: string): Promise<V0TaskRecord>;
  complete(input: V0TaskTransitionInput): Promise<V0TaskRecord>;
  markPushed?(input: V0TaskPushedInput): Promise<V0TaskRecord>;
  requestPrRetry?(taskId: string, requestedAt: string): Promise<V0TaskRecord>;
  appendLog(input: V0TaskLogInput): Promise<V0TaskLogRecord | null>;
  listLogs(taskId: string, limit: number): Promise<readonly V0TaskLogRecord[]>;
}

export interface AgentUsageInput extends AgentUsageMetrics {
  id?: string;
  executionId?: string | null;
  taskId?: string | null;
  projectId: string;
  githubIssueNumber?: number | null;
  githubPullRequestNumber?: number | null;
  provider: string;
  startedAt: string;
  finishedAt?: string | null;
  wallDurationMs?: number | null;
  costKind?: AgentUsageCostKind;
  observedAt: string;
}

export interface AgentUsageQuery {
  projectId?: string;
  provider?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface AgentUsageRepository {
  record(input: AgentUsageInput): Promise<AgentUsageRecord>;
  list(query?: AgentUsageQuery): Promise<readonly AgentUsageRecord[]>;
}

export interface ProjectRepository {
  getById(projectId: string): Promise<ProjectRecord | null>;
  getByRepositoryId(repositoryId: string): Promise<ProjectRecord | null>;
  list(): Promise<readonly ProjectRecord[]>;
  register(input: ProjectRegistrationInput): Promise<ProjectRecord>;
  updatePriority(projectId: string, priority: number): Promise<ProjectRecord>;
  updateState(projectId: string, state: ProjectControlState): Promise<ProjectRecord>;
  /** Queues a destructive cleanup; false means it was already queued. */
  requestDeletion(projectId: string, requestedAt: string): Promise<boolean>;
  listDeletionRequests(): Promise<readonly ProjectDeletionRequestRecord[]>;
  /** Deletes the project and every project-owned row through database cascades. */
  delete(projectId: string): Promise<boolean>;
}

export interface ProjectSnapshotRepository {
  append(input: ProjectSnapshotInput): Promise<ProjectSnapshotRecord>;
  getLatestByProjectId(projectId: string): Promise<ProjectSnapshotRecord | null>;
  /** Latest snapshot per project, used by the Dashboard overview read model. */
  listLatestForProjects(
    projectIds: readonly string[],
  ): Promise<readonly ProjectSnapshotRecord[]>;
}

export interface RunnerRepository {
  getById(runnerId: string): Promise<RunnerRecord | null>;
  list(): Promise<readonly RunnerRecord[]>;
  register(input: RunnerRegistrationInput): Promise<RunnerRecord>;
  recordHeartbeat(runnerId: string, heartbeatAt: string): Promise<RunnerRecord>;
  updateState(runnerId: string, state: RunnerState): Promise<RunnerRecord>;
}

export interface ExecutionRepository {
  getById(executionId: string): Promise<ExecutionRecord | null>;
  listActive(): Promise<readonly ExecutionRecord[]>;
  listByProjectId(projectId: string, limit: number): Promise<readonly ExecutionRecord[]>;
  markDispatched(executionId: string, startedAt: string): Promise<ExecutionRecord>;
  markRunning(executionId: string, startedAt: string): Promise<ExecutionRecord>;
  scheduleWithLease(
    input: ScheduleExecutionWithLeaseInput,
  ): Promise<ScheduledExecutionRecord | null>;
  complete(input: ExecutionCompletionInput): Promise<CompletionResult>;
  listReconciliationCandidates(asOf: string): Promise<readonly ReconciliationCandidate[]>;
}

export interface ExecutionLeaseRepository {
  getActiveByLeaseKey(leaseKey: string): Promise<ExecutionLeaseRecord | null>;
  heartbeat(
    executionId: string,
    ownerId: string,
    heartbeatAt: string,
    expiresAt: string,
  ): Promise<ExecutionLeaseRecord>;
  listStale(asOf: string): Promise<readonly ExecutionLeaseRecord[]>;
  releaseByExecutionId(
    executionId: string,
    releaseReason: string,
    releasedAt: string,
  ): Promise<ExecutionLeaseRecord | null>;
}

export interface AdeDeliveryWorkflowRepository {
  start(input: AdeDeliveryWorkflowStartInput): Promise<AdeDeliveryWorkflowRecord>;
  getByExecutionId(executionId: string): Promise<AdeDeliveryWorkflowRecord | null>;
  getById(workflowId: string): Promise<AdeDeliveryWorkflowRecord | null>;
  listTransitions(workflowId: string): Promise<readonly AdeDeliveryStageTransitionRecord[]>;
  transition(input: AdeDeliveryWorkflowTransitionInput): Promise<AdeDeliveryWorkflowRecord>;
}

export interface ProviderQuotaSnapshotRepository {
  append(input: ProviderQuotaSnapshotInput): Promise<ProviderQuotaSnapshotRecord>;
  getLatest(
    provider: string,
    accountRef: string,
  ): Promise<ProviderQuotaSnapshotRecord | null>;
  deleteOlderThan?(
    provider: string,
    accountRef: string,
    before: string,
  ): Promise<void>;
}

export interface ControlCommandRepository {
  getById(commandId: string): Promise<ControlCommandRecord | null>;
  list(): Promise<readonly ControlCommandRecord[]>;
  listForProject(projectId: string, limit: number): Promise<readonly ControlCommandRecord[]>;
  recordReceipt(input: ControlCommandReceiptInput): Promise<ControlCommandRecord>;
  updateStatus(
    commandId: string,
    update: ControlCommandStatusUpdate,
  ): Promise<ControlCommandRecord>;
}

export interface AuditEventRepository {
  append(input: AuditEventInput): Promise<AuditEventRecord>;
  listForExecution(executionId: string): Promise<readonly AuditEventRecord[]>;
  listForProject(projectId: string, limit: number): Promise<readonly AuditEventRecord[]>;
  listRecent(limit: number): Promise<readonly AuditEventRecord[]>;
}

export interface WorkerWakeup {
  reason: string;
  projectId: string | null;
  signaledAt: string;
}

export interface WorkerWakeupRepository {
  signal(input: WorkerWakeup): Promise<void>;
  listen(handler: (wakeup: WorkerWakeup) => void): Promise<() => Promise<void>>;
}

export interface ControlPlanePersistence {
  readonly v0Tasks: V0TaskRepository;
  readonly adeDecisions: AdeDecisionRepository;
  readonly githubBotComments: GithubBotCommentRepository;
  readonly githubDeliveries: GithubDeliveryRepository;
  readonly githubWork: GithubWorkRepository;
  readonly settings: ControlPlaneSettingsRepository;
  readonly projects: ProjectRepository;
  readonly projectSnapshots: ProjectSnapshotRepository;
  readonly runners: RunnerRepository;
  readonly executions: ExecutionRepository;
  readonly executionLeases: ExecutionLeaseRepository;
  readonly deliveryWorkflows?: AdeDeliveryWorkflowRepository;
  readonly providerQuotaSnapshots: ProviderQuotaSnapshotRepository;
  readonly controlCommands: ControlCommandRepository;
  readonly auditEvents: AuditEventRepository;
  readonly wakeups?: WorkerWakeupRepository;
  readonly agentUsage?: AgentUsageRepository;
  close(): Promise<void>;
  migrate(): Promise<readonly string[]>;
}
