import {
  PostgresControlPlaneStore,
  readDatabaseUrlFromEnvironment,
} from "@ade-control-plane/database";
import {
  GithubAppTokenProvider,
  HttpGithubClient,
} from "@ade-control-plane/github";

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
      codexEnvironment: config.codexEnvironment,
      gitEnvironment: config.gitEnvironment,
      timeoutMs: config.taskTimeoutMs,
    });
    const worker = new V0TaskWorker({
      persistence: store,
      executor,
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
