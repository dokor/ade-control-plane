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
