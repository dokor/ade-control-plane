export interface WorkerWakeEvent {
  reason: string;
  projectId: string | null;
  fullReconcile: boolean;
}

/** Coalesces external signals so bursts of webhooks cause one scheduler wake. */
export class WorkerWakeCoordinator {
  private pending: WorkerWakeEvent | null = null;
  private waiter: ((event: WorkerWakeEvent) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushScheduled = false;

  public wake(input: { reason: string; projectId?: string | null; fullReconcile?: boolean }): void {
    const event: WorkerWakeEvent = {
      reason: input.reason.slice(0, 100),
      projectId: input.projectId ?? null,
      fullReconcile: input.fullReconcile ?? false,
    };
    if (this.pending) {
      this.pending = {
        reason: event.reason,
        projectId: event.projectId ?? this.pending.projectId,
        fullReconcile: this.pending.fullReconcile || event.fullReconcile,
      };
    } else {
      this.pending = event;
    }
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => {
        this.flushScheduled = false;
        this.flush();
      });
    }
  }

  public wait(timeoutMs: number, signal?: AbortSignal): Promise<WorkerWakeEvent> {
    if (this.pending) {
      const event = this.pending;
      this.pending = null;
      return Promise.resolve(event);
    }
    return new Promise((resolve) => {
      const finish = (event: WorkerWakeEvent): void => {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.waiter = null;
        signal?.removeEventListener("abort", onAbort);
        resolve(event);
      };
      const onAbort = (): void => finish({ reason: "shutdown", projectId: null, fullReconcile: false });
      this.waiter = finish;
      this.timer = setTimeout(() => finish({ reason: "periodic-full-reconcile", projectId: null, fullReconcile: true }), Math.max(1_000, timeoutMs));
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private flush(): void {
    if (!this.waiter || !this.pending) return;
    const event = this.pending;
    this.pending = null;
    this.waiter(event);
  }
}
