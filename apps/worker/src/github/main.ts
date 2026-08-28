import { hostname } from "node:os";

import { PostgresControlPlaneStore, readDatabaseUrlFromEnvironment } from "@ade-control-plane/database";
import { GithubAppTokenProvider, HttpGithubClient, HttpGithubWorkAdapter } from "@ade-control-plane/github";

import { NodeCommandRunner } from "../v0/CommandRunner.js";
import { loadV0WorkerRuntime } from "../v0/runtime.js";
import { GithubWorkCodexExecutor } from "../GithubWorkCodexExecutor.js";
import { GithubWorkOrchestrator } from "../GithubWorkOrchestrator.js";

async function main(): Promise<void> {
  const config = await loadV0WorkerRuntime();
  const store = new PostgresControlPlaneStore({
    applicationName: "ade-control-plane-github-work-worker",
    connectionString: await readDatabaseUrlFromEnvironment(),
    maxConnections: 4,
  });
  const stop = new AbortController();
  const requestStop = (): void => stop.abort();
  process.on("SIGTERM", requestStop);
  process.on("SIGINT", requestStop);

  try {
    await store.migrate();
    const tokens = new GithubAppTokenProvider({ credentials: config.github });
    const github = new HttpGithubClient({ tokens, installationId: config.github.installationId });
    const orchestrator = new GithubWorkOrchestrator({
      persistence: store,
      reader: new HttpGithubWorkAdapter({ tokens, installationId: config.github.installationId }),
      dispatcher: new GithubWorkCodexExecutor({
        github, commands: new NodeCommandRunner(), projectRoot: config.projectRoot,
        codexExecutable: config.codexExecutable, codexEnvironment: config.codexEnvironment,
        gitEnvironment: config.gitEnvironment,
      }),
      ownerId: `github-work:${hostname()}:${process.pid}`,
      allowStartWithoutQuotaSnapshot: config.codexAppServerUrl === null,
    });
    await ensureLocalRunner(store);
    while (!stop.signal.aborted) {
      const mode = (await store.settings.get()).schedulerMode;
      if (mode === "running") await orchestrator.runCycle();
      await sleep(config.idleDelayMs, stop.signal);
    }
  } finally {
    process.off("SIGTERM", requestStop);
    process.off("SIGINT", requestStop);
    await store.close();
  }
}

async function ensureLocalRunner(store: PostgresControlPlaneStore): Promise<void> {
  const existing = (await store.runners.list()).find(({ name }) => name === "github-work-local");
  const now = new Date().toISOString();
  if (existing) {
    if (existing.state !== "online") await store.runners.updateState(existing.id, "online");
    await store.runners.recordHeartbeat(existing.id, now);
    return;
  }
  await store.runners.register({
    name: "github-work-local", kind: "local-codex", state: "online",
    architecture: process.arch === "arm64" ? "arm64" : "x64",
    capabilities: { codex: true }, labels: ["local"], lastHeartbeatAt: now,
  });
}

async function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
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

void main().catch(() => {
  console.error("GitHub work worker stopped unexpectedly.");
  process.exitCode = 1;
});
