import {
  PostgresControlPlaneStore,
  readDatabaseUrlFromEnvironment,
} from "@ade-control-plane/database";
import {
  GithubAppTokenProvider,
  HttpGithubClient,
} from "@ade-control-plane/github";
import {
  CodexAppServerQuotaSource,
  QuotaRefreshCoordinator,
} from "@ade-control-plane/quota";

import { NodeCommandRunner } from "./CommandRunner.js";
import { V0TaskExecutor } from "./V0TaskExecutor.js";
import { V0TaskWorker } from "./V0TaskWorker.js";
import { loadV0WorkerRuntime } from "./runtime.js";

async function main(): Promise<void> {
  const config = await loadV0WorkerRuntime();
  const store = new PostgresControlPlaneStore({
    applicationName: "ade-control-plane-v0-worker",
    connectionString: await readDatabaseUrlFromEnvironment(),
    maxConnections: 4,
  });
  const stop = new AbortController();
  const requestStop = (): void => stop.abort();
  process.on("SIGTERM", requestStop);
  process.on("SIGINT", requestStop);

  try {
    await store.migrate();
    const tokens = new GithubAppTokenProvider({
      credentials: {
        appId: config.github.appId,
        privateKey: config.github.privateKey,
      },
    });
    const github = new HttpGithubClient({
      tokens,
      installationId: config.github.installationId,
    });
    const executor = new V0TaskExecutor({
      persistence: store,
      github,
      commands: new NodeCommandRunner(),
      projectRoot: config.projectRoot,
      codexExecutable: config.codexExecutable,
      adeExecutable: config.adeExecutable,
      adeProfile: config.adeProfile,
      adeRuntimeVersion: config.adeRuntimeVersion,
      codexEnvironment: config.codexEnvironment,
      gitEnvironment: config.gitEnvironment,
      timeoutMs: config.taskTimeoutMs,
    });
    const quota = config.codexAppServerUrl
      ? new QuotaRefreshCoordinator({
          provider: "openai",
          accountRef: config.quotaAccountRef,
          source: new CodexAppServerQuotaSource({
            url: config.codexAppServerUrl,
            accountRef: config.quotaAccountRef,
            freshnessMs: 300_000,
          }),
          persistence: {
            append: async ({ snapshot, policyState }) => {
              await store.providerQuotaSnapshots.append({
                provider: snapshot.provider,
                accountRef: snapshot.accountRef,
                policyState,
                usedPercent: snapshot.usedPercent,
                observedAt: snapshot.observedAt,
                ...(snapshot.windowDurationMins !== undefined
                  ? { windowDurationMins: snapshot.windowDurationMins }
                  : {}),
                ...(snapshot.windowStartedAt !== undefined
                  ? { windowStartedAt: snapshot.windowStartedAt }
                  : {}),
                ...(snapshot.resetsAt !== undefined ? { resetsAt: snapshot.resetsAt } : {}),
                ...(snapshot.expiresAt !== undefined ? { expiresAt: snapshot.expiresAt } : {}),
                metadata: { ...(snapshot.metadata ?? {}) },
              });
            },
            getLatest: async (provider, accountRef) => {
              const snapshot = await store.providerQuotaSnapshots.getLatest(provider, accountRef);
              if (!snapshot) return null;
              const metadata: Record<string, string> = {};
              for (const [key, value] of Object.entries(snapshot.metadata)) {
                if (typeof value === "string") metadata[key] = value;
              }
              return {
                provider: snapshot.provider,
                accountRef: snapshot.accountRef,
                usedPercent: snapshot.usedPercent,
                ...(snapshot.windowDurationMins !== null
                  ? { windowDurationMins: snapshot.windowDurationMins }
                  : {}),
                ...(snapshot.windowStartedAt !== null
                  ? { windowStartedAt: snapshot.windowStartedAt }
                  : {}),
                ...(snapshot.resetsAt !== null ? { resetsAt: snapshot.resetsAt } : {}),
                observedAt: snapshot.observedAt,
                ...(snapshot.expiresAt !== null ? { expiresAt: snapshot.expiresAt } : {}),
                metadata,
              };
            },
            deleteOlderThan: async (provider, accountRef, before) => {
              await store.providerQuotaSnapshots.deleteOlderThan?.(provider, accountRef, before);
            },
          },
          policy: async () => {
            const settings = await store.settings.get();
            return {
              throttledAtPercent: settings.quotaThrottledPercent,
              drainingAtPercent: settings.quotaDrainingPercent,
              blockedAtPercent: settings.quotaBlockedPercent,
              staleAfterMs: settings.quotaStaleAfterMs,
              allowStartWhenUnknown: false,
            };
          },
          onPolicyTransition: async ({ from, to, observedAt, resetsAt }) => {
            await store.auditEvents.append({
              occurredAt: observedAt,
              category: "quota",
              severity: to === "blocked" || to === "unknown" ? "warning" : "info",
              actorType: "system",
              actorRef: "quota-coordinator",
              action: "quota-policy-transition",
              reason: `Provider quota changed from ${from ?? "uninitialized"} to ${to}.`,
              result: to,
              metadata: {
                provider: "openai",
                accountRef: config.quotaAccountRef,
                ...(resetsAt ? { resetsAt } : {}),
              },
            });
          },
        })
      : undefined;
    const worker = new V0TaskWorker({
      persistence: store,
      executor,
      ...(quota ? { quota } : {}),
      idleDelayMs: config.idleDelayMs,
    });
    await worker.run(stop.signal);
  } finally {
    process.off("SIGTERM", requestStop);
    process.off("SIGINT", requestStop);
    await store.close();
  }
}

void main().catch(() => {
  console.error("V0 worker stopped unexpectedly.");
  process.exitCode = 1;
});
