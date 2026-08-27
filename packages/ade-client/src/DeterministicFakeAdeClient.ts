import type {
  AdeAdvanceRequest,
  AdeAdvanceResult,
  AdeCapabilities,
  AdeClient,
  AdeExecutionReconciliation,
  AdeHumanDecision,
  AdeHumanDecisionResult,
  AdeProjectRef,
  AdeProjectStatus,
  AdeRunnableWork,
} from "./domain.js";
import { AdeClientError } from "./errors.js";

export interface FakeAdeProjectScenario {
  capabilities: AdeCapabilities;
  decisionResult?: AdeHumanDecisionResult;
  reconciliationByExecutionId?: Readonly<Record<string, AdeExecutionReconciliation>>;
  runnableWork: AdeRunnableWork | null;
  status: AdeProjectStatus;
  advanceByExecutionId?: Readonly<Record<string, AdeAdvanceResult>>;
}

export interface FakeAdeRequest {
  operation: "capabilities" | "status" | "runnable-work" | "advance" | "apply-decision" | "reconcile";
  projectId: string;
}

/** Deterministic test adapter. It never reads a repository or starts a process. */
export class DeterministicFakeAdeClient implements AdeClient {
  private readonly requests: FakeAdeRequest[] = [];

  public constructor(private readonly scenarios: Readonly<Record<string, FakeAdeProjectScenario>>) {}

  public getRequests(): readonly FakeAdeRequest[] {
    return [...this.requests];
  }

  public async getCapabilities(project: AdeProjectRef): Promise<AdeCapabilities> {
    this.record("capabilities", project);
    return this.scenario(project).capabilities;
  }

  public async getStatus(project: AdeProjectRef): Promise<AdeProjectStatus> {
    this.record("status", project);
    return this.scenario(project).status;
  }

  public async getRunnableWork(project: AdeProjectRef): Promise<AdeRunnableWork | null> {
    this.record("runnable-work", project);
    return this.scenario(project).runnableWork;
  }

  public async advance(project: AdeProjectRef, request: AdeAdvanceRequest): Promise<AdeAdvanceResult> {
    this.record("advance", project);
    const result = this.scenario(project).advanceByExecutionId?.[request.controlPlaneExecutionId];
    if (!result) {
      throw new AdeClientError("ADE_OUTPUT_INVALID", "never", "No fake advance result is configured for this execution.");
    }
    return result;
  }

  public async applyHumanDecision(project: AdeProjectRef, decision: AdeHumanDecision): Promise<AdeHumanDecisionResult> {
    this.record("apply-decision", project);
    const result = this.scenario(project).decisionResult;
    if (!result || result.decisionRef !== decision.decisionRef) {
      throw new AdeClientError("ADE_OUTPUT_INVALID", "never", "No matching fake human decision is configured.");
    }
    return result;
  }

  public async reconcileExecution(
    project: AdeProjectRef,
    controlPlaneExecutionId: string,
  ): Promise<AdeExecutionReconciliation> {
    this.record("reconcile", project);
    const result = this.scenario(project).reconciliationByExecutionId?.[controlPlaneExecutionId];
    if (!result) {
      return { controlPlaneExecutionId, state: "not-found" };
    }
    return result;
  }

  private record(operation: FakeAdeRequest["operation"], project: AdeProjectRef): void {
    this.requests.push({ operation, projectId: project.projectId });
  }

  private scenario(project: AdeProjectRef): FakeAdeProjectScenario {
    const scenario = this.scenarios[project.projectId];
    if (!scenario) {
      throw new AdeClientError("ADE_PROJECT_NOT_CONFIGURED", "never", "ADE project is not configured.");
    }
    return scenario;
  }
}
