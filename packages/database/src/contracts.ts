import type {
  AuditEventRecord,
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
  ProjectRecord,
  ProjectSnapshotRecord,
  ProviderQuotaPolicyState,
  ProviderQuotaSnapshotRecord,
  ReconciliationCandidate,
  RunnerRecord,
  RunnerState,
  ScheduledExecutionRecord,
} from "./domain.js";

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

export interface ProjectRepository {
  getById(projectId: string): Promise<ProjectRecord | null>;
  list(): Promise<readonly ProjectRecord[]>;
  register(input: ProjectRegistrationInput): Promise<ProjectRecord>;
  updatePriority(projectId: string, priority: number): Promise<ProjectRecord>;
  updateState(projectId: string, state: ProjectControlState): Promise<ProjectRecord>;
}

export interface ProjectSnapshotRepository {
  append(input: ProjectSnapshotInput): Promise<ProjectSnapshotRecord>;
  getLatestByProjectId(projectId: string): Promise<ProjectSnapshotRecord | null>;
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

export interface ProviderQuotaSnapshotRepository {
  append(input: ProviderQuotaSnapshotInput): Promise<ProviderQuotaSnapshotRecord>;
  getLatest(
    provider: string,
    accountRef: string,
  ): Promise<ProviderQuotaSnapshotRecord | null>;
}

export interface ControlCommandRepository {
  getById(commandId: string): Promise<ControlCommandRecord | null>;
  list(): Promise<readonly ControlCommandRecord[]>;
  recordReceipt(input: ControlCommandReceiptInput): Promise<ControlCommandRecord>;
  updateStatus(
    commandId: string,
    update: ControlCommandStatusUpdate,
  ): Promise<ControlCommandRecord>;
}

export interface AuditEventRepository {
  append(input: AuditEventInput): Promise<AuditEventRecord>;
  listForExecution(executionId: string): Promise<readonly AuditEventRecord[]>;
}

export interface ControlPlanePersistence {
  readonly projects: ProjectRepository;
  readonly projectSnapshots: ProjectSnapshotRepository;
  readonly runners: RunnerRepository;
  readonly executions: ExecutionRepository;
  readonly executionLeases: ExecutionLeaseRepository;
  readonly providerQuotaSnapshots: ProviderQuotaSnapshotRepository;
  readonly controlCommands: ControlCommandRepository;
  readonly auditEvents: AuditEventRepository;
  close(): Promise<void>;
  migrate(): Promise<readonly string[]>;
}
