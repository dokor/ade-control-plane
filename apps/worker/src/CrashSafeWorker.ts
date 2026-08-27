export type WorkerMode = "running" | "paused" | "safe_mode";
export type CycleOutcome = "dispatched" | "idle" | "waiting_quota" | "reconciling" | "error";

export interface WorkerCycleResult {
  outcome: CycleOutcome;
  nextWakeUpAt?: string;
}

/** Ports keep the always-on worker out of the host execution trust zone. */
export interface CrashSafeWorkerDependencies {
  recoverIncompleteExecutions(): Promise<void>;
  runCycle(): Promise<WorkerCycleResult>;
  recordCycleFailure(): Promise<void>;
  getMode(): Promise<WorkerMode>;
  now?(): Date;
  sleep(milliseconds: number): Promise<void>;
  idleDelayMs?: number;
  errorBackoffMs?: number;
}

export class CrashSafeWorker {
  private stopping = false;
  private started = false;

  public constructor(private readonly dependencies: CrashSafeWorkerDependencies) {}

  public requestStop(): void { this.stopping = true; }

  /** SIGTERM/SIGINT stop after the current typed operation completes. */
  public installSignalHandlers(processRef: NodeJS.Process = process): () => void {
    const stop = (): void => this.requestStop();
    processRef.on("SIGTERM", stop); processRef.on("SIGINT", stop);
    return () => { processRef.off("SIGTERM", stop); processRef.off("SIGINT", stop); };
  }

  public async run(): Promise<void> {
    if (!this.started) { this.started = true; await this.dependencies.recoverIncompleteExecutions(); }
    while (!this.stopping) {
      const mode = await this.dependencies.getMode();
      if (mode !== "running") { await this.dependencies.sleep(this.idleDelayMs); continue; }
      try {
        const result = await this.dependencies.runCycle();
        await this.dependencies.sleep(this.delayFor(result));
      } catch {
        await this.dependencies.recordCycleFailure();
        await this.dependencies.sleep(this.errorBackoffMs);
      }
    }
  }

  private delayFor(result: WorkerCycleResult): number {
    const wakeAt = result.nextWakeUpAt === undefined ? Number.NaN : Date.parse(result.nextWakeUpAt);
    const now = (this.dependencies.now ?? (() => new Date()))().getTime();
    if (!Number.isNaN(wakeAt)) return Math.max(0, wakeAt - now);
    return result.outcome === "error" ? this.errorBackoffMs : this.idleDelayMs;
  }

  private get idleDelayMs(): number { return this.dependencies.idleDelayMs ?? 5_000; }
  private get errorBackoffMs(): number { return this.dependencies.errorBackoffMs ?? 30_000; }
}
