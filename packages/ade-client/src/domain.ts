export const ADE_PROTOCOL_VERSION = "1" as const;

export type AdeProjectState =
  | "unknown"
  | "ready"
  | "running"
  | "waiting-human"
  | "blocked"
  | "failed"
  | "completed";

export type AdeRetryClassification = "never" | "safe" | "reconcile-first";

export type AdeOperation =
  | "capabilities"
  | "status"
  | "runnable-work"
  | "advance"
  | "apply-decision"
  | "reconcile";

export interface AdeProjectRef {
  projectId: string;
  repository: string;
  projectRef: string;
}

export interface AdeCapabilities {
  protocolVersion: typeof ADE_PROTOCOL_VERSION;
  adeVersion: string;
  operations: readonly AdeOperation[];
  observedAt: string;
}

export interface AdeWorkSummary {
  ref: string;
  summary: string;
}

export interface AdeHumanDecisionOption {
  label: string;
  value: string;
}

export interface AdeHumanDecisionRequest {
  reference: string;
  options: readonly AdeHumanDecisionOption[];
  summary?: string;
}

export interface AdeProjectStatus {
  projectId: string;
  state: AdeProjectState;
  adeRunRef?: string;
  stage?: string;
  milestone?: string;
  currentWork?: AdeWorkSummary;
  nextWork?: AdeWorkSummary;
  waitingReason?: string;
  humanDecision?: AdeHumanDecisionRequest;
  observedAt: string;
  expiresAt?: string;
  capabilities: AdeCapabilities;
}

export interface AdeRunnableWork {
  ref: string;
  summary: string;
  estimatedClass?: "short" | "normal" | "long";
  requiredRunnerLabels?: readonly string[];
}

export interface AdeAdvanceRequest {
  controlPlaneExecutionId: string;
  workRef?: string;
}

export interface AdeAdvanceResult {
  adeExecutionRef?: string;
  controlPlaneExecutionId: string;
  state:
    | "accepted"
    | "running"
    | "succeeded"
    | "waiting-human"
    | "blocked"
    | "failed"
    | "unknown";
  summary: string;
  nextAction?: string;
  references?: readonly string[];
}

export interface AdeHumanDecision {
  actorRef: string;
  decisionRef: string;
  option: string;
}

export interface AdeHumanDecisionResult {
  decisionRef: string;
  state: "applied" | "rejected";
  summary?: string;
}

export interface AdeExecutionReconciliation {
  adeExecutionRef?: string;
  controlPlaneExecutionId: string;
  state: "running" | "succeeded" | "failed" | "cancelled" | "unknown" | "not-found";
  summary?: string;
}

/** Stable, transport-independent boundary between the control plane and ADE. */
export interface AdeClient {
  getCapabilities(project: AdeProjectRef): Promise<AdeCapabilities>;
  getStatus(project: AdeProjectRef): Promise<AdeProjectStatus>;
  getRunnableWork(project: AdeProjectRef): Promise<AdeRunnableWork | null>;
  advance(project: AdeProjectRef, request: AdeAdvanceRequest): Promise<AdeAdvanceResult>;
  applyHumanDecision(
    project: AdeProjectRef,
    decision: AdeHumanDecision,
  ): Promise<AdeHumanDecisionResult>;
  reconcileExecution(
    project: AdeProjectRef,
    controlPlaneExecutionId: string,
    adeExecutionRef?: string,
  ): Promise<AdeExecutionReconciliation>;
}
