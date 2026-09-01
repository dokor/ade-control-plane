import type { QuotaRefreshResult } from "@ade-control-plane/quota";

import type { GithubWorkCycleResult } from "./GithubWorkOrchestrator.js";
import type { WorkerWakeCoordinator, WorkerWakeEvent } from "./WorkerWakeCoordinator.js";

export interface UnifiedProductionWorkerOptions {
  wake: Pick<WorkerWakeCoordinator, "wait">;
  manual: { recoverInterruptedTask(): Promise<void>; runOnce(signal?: AbortSignal): Promise<boolean> };
  github: { runCycle(input: { reconcile: "full" | "targeted" | "none"; projectId?: string }): Promise<GithubWorkCycleResult> };
  quota?: { refresh(): Promise<QuotaRefreshResult> };
  fullReconcileIntervalMs: number;
  onCycle?(event: WorkerWakeEvent, outcome: string): Promise<void>;
}

/**
 * The production process owns one execution slot. A durable manual task wins
 * over automatic GitHub work; both dispatchers are awaited serially.
 */
export class UnifiedProductionWorker {
  public constructor(private readonly options: UnifiedProductionWorkerOptions) {}

  public async run(signal: AbortSignal): Promise<void> {
    await this.options.manual.recoverInterruptedTask();
    while (!signal.aborted) {
      const event = await this.options.wake.wait(this.options.fullReconcileIntervalMs, signal);
      if (signal.aborted || event.reason === "shutdown") break;
      await this.runOnce(event, signal);
    }
  }

  public async runOnce(event: WorkerWakeEvent, signal?: AbortSignal): Promise<string> {
    const quota = this.options.quota ? await this.options.quota.refresh() : null;
    if (quota && !quota.decision.canStartWork) {
      await this.options.onCycle?.(event, "quota-blocked");
      return "quota-blocked";
    }
    if (await this.options.manual.runOnce(signal)) {
      await this.options.onCycle?.(event, "manual-task");
      return "manual-task";
    }
    const result = await this.options.github.runCycle(
        event.fullReconcile
          ? { reconcile: "full" }
          : event.projectId
            ? { reconcile: "targeted", projectId: event.projectId }
            : { reconcile: "none" },
    );
    await this.options.onCycle?.(event, result.outcome);
    return result.outcome;
  }
}
