import type { ControlPlanePersistence, ReconciliationCandidate } from "@ade-control-plane/database";
import type { AdeProjectRef } from "@ade-control-plane/ade-client";
import type { RunnerControlPlaneClient } from "./index.js";

export interface RecoveryProjectResolver { get(projectId: string): Promise<AdeProjectRef | null>; }

/** Reconciliation is mandatory before an uncertain execution can be scheduled again. */
export class DurableExecutionCoordinator {
  public constructor(
    private readonly store: ControlPlanePersistence,
    private readonly runner: Pick<RunnerControlPlaneClient, "reconcile">,
    private readonly projects: RecoveryProjectResolver,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async recover(): Promise<void> {
    const candidates = await this.store.executions.listReconciliationCandidates(this.now().toISOString());
    for (const candidate of candidates) await this.reconcile(candidate);
  }

  private async reconcile(candidate: ReconciliationCandidate): Promise<void> {
    const project = await this.projects.get(candidate.execution.projectId);
    if (!project) { await this.recordUnknown(candidate, "PROJECT_UNAVAILABLE"); return; }
    let result: Awaited<ReturnType<RunnerControlPlaneClient["reconcile"]>>;
    try { result = await this.runner.reconcile(project, candidate.execution.id, candidate.execution.adeExecutionRef ?? undefined); }
    catch { await this.recordUnknown(candidate, "RUNNER_RECONCILIATION_UNAVAILABLE"); return; }
    if (result.state === "running" || result.state === "unknown" || result.state === "not-found") { await this.recordUnknown(candidate, "EXECUTION_STATE_UNKNOWN"); return; }
    await this.store.executions.complete({
      executionId: candidate.execution.id, status: result.state,
      finishedAt: this.now().toISOString(), releaseReason: "runner-reconciliation",
      resultSummary: result.summary === undefined ? null : { summary: result.summary },
      auditEvent: this.audit(candidate, "execution.reconciled", result.state),
    });
  }

  private async recordUnknown(candidate: ReconciliationCandidate, code: string): Promise<void> {
    await this.store.executions.complete({
      executionId: candidate.execution.id, status: "unknown", finishedAt: this.now().toISOString(),
      errorCode: code, errorSummary: "Execution completion requires reconciliation.",
      releaseReason: "reconciliation-pending", auditEvent: this.audit(candidate, "execution.reconciliation-pending", "unknown"),
    });
  }

  private audit(candidate: ReconciliationCandidate, action: string, result: string) {
    return { occurredAt: this.now().toISOString(), category: "execution", severity: "info", actorType: "system", projectId: candidate.execution.projectId, executionId: candidate.execution.id, runnerId: candidate.execution.runnerId, action, result, metadata: { recoveryReason: candidate.reason } };
  }
}
