import type { QuotaRefreshResult } from "@ade-control-plane/quota";

import type { GithubWorkCycleResult } from "./GithubWorkOrchestrator.js";
import type { WorkerWakeCoordinator, WorkerWakeEvent } from "./WorkerWakeCoordinator.js";

export interface UnifiedProductionWorkerOptions {
  wake: Pick<WorkerWakeCoordinator, "wait">;
  manual: { recoverInterruptedTask(): Promise<void>; runOnce(signal?: AbortSignal): Promise<boolean> };
  github: { runCycle(input: { reconcile: "full" | "targeted" | "none"; projectId?: string }): Promise<GithubWorkCycleResult> };
  quota?: { refresh(force?: boolean): Promise<QuotaRefreshResult> };
  fullReconcileIntervalMs: number;
  onCycle?(event: WorkerWakeEvent, outcome: string): Promise<void>;
  now?(): Date;
  random?(): number;
}

/**
 * The production process owns one execution slot. A durable manual task wins
 * over automatic GitHub work; both dispatchers are awaited serially.
 */
export class UnifiedProductionWorker {
  private quotaWakeUpAt: string | null = null;
  private readonly now: () => Date;
  private readonly random: () => number;

  public constructor(private readonly options: UnifiedProductionWorkerOptions) {
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
  }

  public async run(signal: AbortSignal): Promise<void> {
    await this.options.manual.recoverInterruptedTask();
    while (!signal.aborted) {
      const event = await this.options.wake.wait(this.nextWaitTimeoutMs(this.options.fullReconcileIntervalMs), signal);
      if (signal.aborted || event.reason === "shutdown") break;
      await this.runOnce(event, signal);
    }
  }

  public async runOnce(event: WorkerWakeEvent, signal?: AbortSignal): Promise<string> {
    const quota = this.options.quota
      ? await this.options.quota.refresh(event.reason === "quota-refresh")
      : null;
    if (quota && !quota.decision.canStartWork) {
      this.quotaWakeUpAt = quotaWakeUpAt(quota.decision.resetsAt, this.now(), this.random());
      await this.options.onCycle?.(event, "quota-blocked");
      return "quota-blocked";
    }
    this.quotaWakeUpAt = null;
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

  /** The next blocked-quota refresh never waits past the normal full reconcile. */
  public nextWaitTimeoutMs(defaultIntervalMs: number): number {
    const defaultDelay = Math.max(1_000, defaultIntervalMs);
    if (!this.quotaWakeUpAt) return defaultDelay;
    const wakeAt = Date.parse(this.quotaWakeUpAt);
    const delay = wakeAt - this.now().getTime();
    return Number.isFinite(delay) && delay > 0 ? Math.min(defaultDelay, Math.max(1_000, delay)) : defaultDelay;
  }
}

function quotaWakeUpAt(resetsAt: string | undefined, now: Date, random: number): string | null {
  if (!resetsAt) return null;
  const resetMs = Date.parse(resetsAt);
  if (Number.isNaN(resetMs) || resetMs <= now.getTime()) return null;
  // Prevent a fleet of workers from querying the provider at precisely the
  // same instant while remaining bounded enough for a useful post-reset read.
  const jitterMs = Math.floor(Math.min(1, Math.max(0, random)) * 30_000);
  return new Date(resetMs + jitterMs).toISOString();
}
