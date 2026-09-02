import { hostname } from "node:os";

import { PostgresControlPlaneStore, readDatabaseUrlFromEnvironment } from "@ade-control-plane/database";
import { GithubAppTokenProvider, HttpGithubClient, HttpGithubIssueAdapter, HttpGithubWorkAdapter } from "@ade-control-plane/github";
import { CodexAppServerQuotaSource, QuotaRefreshCoordinator } from "@ade-control-plane/quota";

import { NodeCommandRunner } from "../v0/CommandRunner.js";
import { loadV0WorkerRuntime, type V0WorkerRuntimeConfig } from "../v0/runtime.js";
import { V0TaskExecutor } from "../v0/V0TaskExecutor.js";
import { V0TaskWorker } from "../v0/V0TaskWorker.js";
import { ProjectDeletionProcessor } from "../v0/ProjectDeletionProcessor.js";
import { provisionRegisteredProjects } from "../v0/ProjectProvisioner.js";
import { GithubWorkCodexExecutor } from "../GithubWorkCodexExecutor.js";
import { GithubWorkOrchestrator } from "../GithubWorkOrchestrator.js";
import { GithubWorkNotifier } from "../GithubWorkNotifier.js";
import { ClaudeCodeAgentExecutor, CodexAgentExecutor } from "../AgentExecutor.js";
import { WorkerWakeCoordinator } from "../WorkerWakeCoordinator.js";
import { UnifiedProductionWorker } from "../UnifiedProductionWorker.js";

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
    const agentExecutor = config.agentProvider === "claude-code"
      ? new ClaudeCodeAgentExecutor({ commands, executable: config.claudeExecutable, environment: config.claudeEnvironment })
      : new CodexAgentExecutor({ commands, executable: config.codexExecutable, environment: config.codexEnvironment });
    const manual = new V0TaskWorker({
      persistence: store,
      executor: new V0TaskExecutor({
        persistence: store, github,
        issueReader: new HttpGithubIssueAdapter({ tokens, installationId: config.github.installationId }),
        commands, projectRoot: config.projectRoot, codexExecutable: config.codexExecutable,
        agentExecutor, adeExecutable: config.adeExecutable, adeProfile: config.adeProfile,
        adeRuntimeVersion: config.adeRuntimeVersion, codexEnvironment: config.codexEnvironment,
        gitEnvironment: config.gitEnvironment, timeoutMs: config.taskTimeoutMs,
      }),
      idleDelayMs: config.idleDelayMs,
      deletionProcessor: new ProjectDeletionProcessor({ persistence: store, commands, projectRoot: config.projectRoot, gitEnvironment: config.gitEnvironment }),
    });
    const quota = createQuotaCoordinator(store, config);
    const orchestrator = new GithubWorkOrchestrator({
      persistence: store,
      reader: new HttpGithubWorkAdapter({ tokens, installationId: config.github.installationId }),
      dispatcher: new GithubWorkCodexExecutor({
        github, commands, projectRoot: config.projectRoot,
        codexExecutable: config.codexExecutable, codexEnvironment: config.codexEnvironment,
        adeExecutable: config.adeExecutable, adeRuntimeVersion: config.adeRuntimeVersion,
        adeContextProfile: config.adeProfile,
        gitEnvironment: config.gitEnvironment,
        agentExecutor,
      }),
      provider: config.agentProvider,
      agentUsage: store.agentUsage,
      ownerId: `github-work:${hostname()}:${process.pid}`,
      // Codex quota observations must never be applied to Claude work. Claude
      // has no live quota source yet, so its explicit policy is unsupported.
      allowStartWithoutQuotaSnapshot: config.agentProvider !== "codex" || config.codexAppServerUrl === null,
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
    await provisionRegisteredProjects({ persistence: store, commands, projectRoot: config.projectRoot, gitEnvironment: config.gitEnvironment }).catch(() => undefined);
    const provisioningTimer = setInterval(() => {
      void provisionRegisteredProjects({ persistence: store, commands, projectRoot: config.projectRoot, gitEnvironment: config.gitEnvironment }).catch(() => undefined);
    }, 30_000);
    provisioningTimer.unref?.();
    const unified = new UnifiedProductionWorker({
      wake, manual, github: orchestrator, ...(quota ? { quota } : {}),
      fullReconcileIntervalMs: config.fullReconcileIntervalMs,
    });
    await manual.recoverInterruptedTask();
    while (!stop.signal.aborted) {
      const event = await wake.wait(unified.nextWaitTimeoutMs(config.fullReconcileIntervalMs), stop.signal);
      if (stop.signal.aborted || event.reason === "shutdown") break;
      await store.runners.recordHeartbeat(runner.id, new Date().toISOString()).catch(() => undefined);
      const mode = (await store.settings.get()).schedulerMode;
      if (mode !== "running") continue;
      try {
        const result = await unified.runOnce(event, stop.signal);
        await recordWorkerAudit(store, "worker.cycle-succeeded", {
          wakeReason: event.reason,
          reconciliation: event.fullReconcile ? "full" : event.projectId ? "targeted" : "none",
          outcome: result,
          nextWakeAt: new Date(Date.now() + config.fullReconcileIntervalMs).toISOString(),
        }).catch(() => undefined);
      } catch {
        await store.auditEvents.append({
          occurredAt: new Date().toISOString(), category: "worker", severity: "warning", actorType: "system",
          action: "worker.cycle-failed", result: "deferred", metadata: { wakeReason: event.reason },
        }).catch(() => undefined);
      }
    }
    clearInterval(provisioningTimer);
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

function createQuotaCoordinator(store: PostgresControlPlaneStore, config: V0WorkerRuntimeConfig) {
  if (config.agentProvider !== "codex" || !config.codexAppServerUrl) return undefined;
  return new QuotaRefreshCoordinator({
    provider: "openai",
    accountRef: config.quotaAccountRef,
    source: new CodexAppServerQuotaSource({ url: config.codexAppServerUrl, accountRef: config.quotaAccountRef, freshnessMs: 300_000 }),
    persistence: {
      append: async ({ snapshot, policyState }) => {
        await store.providerQuotaSnapshots.append({
          provider: snapshot.provider, accountRef: snapshot.accountRef, policyState, usedPercent: snapshot.usedPercent, observedAt: snapshot.observedAt,
          ...(snapshot.windowDurationMins !== undefined ? { windowDurationMins: snapshot.windowDurationMins } : {}),
          ...(snapshot.windowStartedAt !== undefined ? { windowStartedAt: snapshot.windowStartedAt } : {}),
          ...(snapshot.resetsAt !== undefined ? { resetsAt: snapshot.resetsAt } : {}),
          ...(snapshot.expiresAt !== undefined ? { expiresAt: snapshot.expiresAt } : {}), metadata: { ...(snapshot.metadata ?? {}) },
        });
      },
      getLatest: async (provider, accountRef) => {
        const snapshot = await store.providerQuotaSnapshots.getLatest(provider, accountRef);
        if (!snapshot) return null;
        const metadata: Record<string, string> = {};
        for (const [key, value] of Object.entries(snapshot.metadata)) if (typeof value === "string") metadata[key] = value;
        return {
          provider: snapshot.provider, accountRef: snapshot.accountRef, usedPercent: snapshot.usedPercent, observedAt: snapshot.observedAt, metadata,
          ...(snapshot.windowDurationMins !== null ? { windowDurationMins: snapshot.windowDurationMins } : {}),
          ...(snapshot.windowStartedAt !== null ? { windowStartedAt: snapshot.windowStartedAt } : {}),
          ...(snapshot.resetsAt !== null ? { resetsAt: snapshot.resetsAt } : {}),
          ...(snapshot.expiresAt !== null ? { expiresAt: snapshot.expiresAt } : {}),
        };
      },
      deleteOlderThan: async (provider, accountRef, before) => store.providerQuotaSnapshots.deleteOlderThan?.(provider, accountRef, before),
    },
    policy: async () => {
      const settings = await store.settings.get();
      return { throttledAtPercent: settings.quotaThrottledPercent, drainingAtPercent: settings.quotaDrainingPercent, blockedAtPercent: settings.quotaBlockedPercent, staleAfterMs: settings.quotaStaleAfterMs, allowStartWhenUnknown: false };
    },
  });
}

void main().catch(() => {
  console.error("GitHub work worker stopped unexpectedly.");
  process.exitCode = 1;
});
