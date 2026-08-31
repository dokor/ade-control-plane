import { hostname } from "node:os";

import { PostgresControlPlaneStore, readDatabaseUrlFromEnvironment } from "@ade-control-plane/database";
import { GithubAppTokenProvider, HttpGithubClient, HttpGithubWorkAdapter } from "@ade-control-plane/github";

import { NodeCommandRunner } from "../v0/CommandRunner.js";
import { loadV0WorkerRuntime } from "../v0/runtime.js";
import { GithubWorkCodexExecutor } from "../GithubWorkCodexExecutor.js";
import { GithubWorkOrchestrator } from "../GithubWorkOrchestrator.js";
import { GithubWorkNotifier } from "../GithubWorkNotifier.js";
import { ClaudeCodeAgentExecutor, CodexAgentExecutor } from "../AgentExecutor.js";
import { WorkerWakeCoordinator } from "../WorkerWakeCoordinator.js";

async function main(): Promise<void> {
  const config = await loadV0WorkerRuntime();
  const store = new PostgresControlPlaneStore({
    applicationName: "ade-control-plane-github-work-worker",
    connectionString: await readDatabaseUrlFromEnvironment(),
    maxConnections: 4,
  });
  const stop = new AbortController();
  const wake = new WorkerWakeCoordinator();
  let stopWakeups: (() => Promise<void>) | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  const requestStop = (): void => stop.abort();
  process.on("SIGTERM", requestStop);
  process.on("SIGINT", requestStop);

  try {
    await store.migrate();
    const tokens = new GithubAppTokenProvider({ credentials: config.github });
    const github = new HttpGithubClient({ tokens, installationId: config.github.installationId });
    const commands = new NodeCommandRunner();
    const orchestrator = new GithubWorkOrchestrator({
      persistence: store,
      reader: new HttpGithubWorkAdapter({ tokens, installationId: config.github.installationId }),
      dispatcher: new GithubWorkCodexExecutor({
        github, commands, projectRoot: config.projectRoot,
        codexExecutable: config.codexExecutable, codexEnvironment: config.codexEnvironment,
        gitEnvironment: config.gitEnvironment,
        agentExecutor: config.agentProvider === "claude-code"
          ? new ClaudeCodeAgentExecutor({ commands, executable: config.claudeExecutable, environment: config.claudeEnvironment })
          : new CodexAgentExecutor({ commands, executable: config.codexExecutable, environment: config.codexEnvironment }),
      }),
      provider: config.agentProvider,
      agentUsage: store.agentUsage,
      ownerId: `github-work:${hostname()}:${process.pid}`,
      allowStartWithoutQuotaSnapshot: config.codexAppServerUrl === null,
      notifier: new GithubWorkNotifier({
        persistence: store,
        client: github,
        dashboardUrl: config.dashboardUrl,
      }),
    });
    const runner = await ensureLocalRunner(store, config.agentProvider);
    const workerStartedAt = new Date().toISOString();
    await recordWorkerAudit(store, "worker.started", { workerStartedAt, reconcileIntervalMs: config.fullReconcileIntervalMs }).catch(() => undefined);
    stopWakeups = await store.wakeups?.listen((event) => wake.wake(event));
    heartbeatTimer = setInterval(() => {
      void store.runners.recordHeartbeat(runner.id, new Date().toISOString()).catch(() => undefined);
    }, config.heartbeatIntervalMs);
    heartbeatTimer.unref?.();
    wake.wake({ reason: "startup", fullReconcile: true });
    while (!stop.signal.aborted) {
      const event = await wake.wait(config.fullReconcileIntervalMs, stop.signal);
      if (stop.signal.aborted || event.reason === "shutdown") break;
      await store.runners.recordHeartbeat(runner.id, new Date().toISOString()).catch(() => undefined);
      const mode = (await store.settings.get()).schedulerMode;
      if (mode !== "running") continue;
      try {
        const result = await orchestrator.runCycle(
          event.fullReconcile
            ? { reconcile: "full" }
            : event.projectId
              ? { reconcile: "targeted", projectId: event.projectId }
              : { reconcile: "none" },
        );
        await recordWorkerAudit(store, "worker.cycle-succeeded", {
          wakeReason: event.reason,
          reconciliation: event.fullReconcile ? "full" : event.projectId ? "targeted" : "none",
          outcome: result.outcome,
          nextWakeAt: new Date(Date.now() + config.fullReconcileIntervalMs).toISOString(),
        }).catch(() => undefined);
      } catch {
        await store.auditEvents.append({
          occurredAt: new Date().toISOString(), category: "worker", severity: "warning", actorType: "system",
          action: "worker.cycle-failed", result: "deferred", metadata: { wakeReason: event.reason },
        }).catch(() => undefined);
      }
    }
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await stopWakeups?.().catch(() => undefined);
    process.off("SIGTERM", requestStop);
    process.off("SIGINT", requestStop);
    await store.close();
  }
}

async function recordWorkerAudit(store: PostgresControlPlaneStore, action: string, metadata: Record<string, string | number>): Promise<void> {
  await store.auditEvents.append({
    occurredAt: new Date().toISOString(), category: "worker", severity: "info", actorType: "system", action, result: "observed", metadata,
  });
}

async function ensureLocalRunner(store: PostgresControlPlaneStore, provider: "codex" | "claude-code") {
  const existing = (await store.runners.list()).find(({ name }) => name === "github-work-local");
  const now = new Date().toISOString();
  if (existing) {
    if (existing.state !== "online") await store.runners.updateState(existing.id, "online");
    await store.runners.recordHeartbeat(existing.id, now);
    return existing;
  }
  return store.runners.register({
    name: "github-work-local", kind: "local-codex", state: "online",
    architecture: process.arch === "arm64" ? "arm64" : "x64",
    capabilities: { [provider]: true }, labels: ["local"], lastHeartbeatAt: now,
  });
}

void main().catch(() => {
  console.error("GitHub work worker stopped unexpectedly.");
  process.exitCode = 1;
});
