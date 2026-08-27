import type { V0TaskRepository } from "@ade-control-plane/database";

import type { V0TaskExecutor } from "./V0TaskExecutor.js";

interface V0Persistence {
  v0Tasks: Pick<
    V0TaskRepository,
    "list" | "claimPending" | "appendLog" | "complete"
  >;
}

export interface V0TaskWorkerOptions {
  persistence: V0Persistence;
  executor: Pick<V0TaskExecutor, "execute">;
  idleDelayMs?: number;
  now?(): Date;
  sleep?(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export class V0TaskWorker {
  private readonly idleDelayMs: number;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;

  public constructor(private readonly options: V0TaskWorkerOptions) {
    this.idleDelayMs = options.idleDelayMs ?? 2_000;
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? abortableSleep;
  }

  public async recoverInterruptedTask(): Promise<void> {
    const running = (await this.options.persistence.v0Tasks.list(100)).find(
      ({ status }) => status === "RUNNING",
    );
    if (!running) return;
    await this.options.persistence.v0Tasks.appendLog({
      taskId: running.id,
      occurredAt: this.now().toISOString(),
      stream: "system",
      message: "Worker restarted with an interrupted task; implicit retry refused.",
    });
    await this.options.persistence.v0Tasks.complete({
      taskId: running.id,
      status: running.cancelRequested ? "CANCELLED" : "FAILED",
      finishedAt: this.now().toISOString(),
      branchName: running.branchName,
      errorCode: running.cancelRequested ? null : "WORKER_RESTARTED",
      errorSummary: running.cancelRequested
        ? null
        : "Worker restarted before task completion; reconcile branch and GitHub state manually.",
    });
  }

  public async runOnce(signal?: AbortSignal): Promise<boolean> {
    const task = await this.options.persistence.v0Tasks.claimPending(
      this.now().toISOString(),
    );
    if (!task) return false;
    await this.options.executor.execute(task, signal);
    return true;
  }

  public async run(signal: AbortSignal): Promise<void> {
    await this.recoverInterruptedTask();
    while (!signal.aborted) {
      if (!(await this.runOnce(signal))) {
        await this.sleep(this.idleDelayMs, signal);
      }
    }
  }
}

async function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
