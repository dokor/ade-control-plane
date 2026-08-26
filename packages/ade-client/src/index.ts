export interface AdeProjectRef {
  projectId: string;
  repository: string;
}

export type AdeProjectState =
  | "unknown"
  | "ready"
  | "running"
  | "waiting-human"
  | "blocked"
  | "failed"
  | "completed";

export interface AdeProjectStatus {
  projectId: string;
  state: AdeProjectState;
  stage?: string;
  milestone?: string;
  currentWork?: string;
  nextWork?: string;
  blockingReason?: string;
}

export interface AdeRunnableWork {
  id: string;
  summary: string;
  estimatedClass?: "short" | "normal" | "long";
  requiredRunnerLabels?: readonly string[];
}

export interface AdeAdvanceRequest {
  workId: string;
  runnerId: string;
  executionId: string;
}

export interface AdeAdvanceResult {
  executionId: string;
  state: "completed" | "waiting-human" | "blocked" | "failed";
  summary: string;
  nextAction?: string;
  references?: readonly string[];
}

export interface AdeHumanDecision {
  decisionId: string;
  value: string;
  actor: string;
}

/** Stable boundary between the multi-project control plane and ADE. */
export interface AdeClient {
  getStatus(project: AdeProjectRef): Promise<AdeProjectStatus>;
  getRunnableWork(project: AdeProjectRef): Promise<AdeRunnableWork | null>;
  advance(
    project: AdeProjectRef,
    request: AdeAdvanceRequest,
  ): Promise<AdeAdvanceResult>;
  applyHumanDecision(
    project: AdeProjectRef,
    decision: AdeHumanDecision,
  ): Promise<void>;
}
