import { loadHostRunnerRuntime, startHostRunner } from "@ade-control-plane/host-runner";

async function main(): Promise<void> {
  const runtime = await startHostRunner(await loadHostRunnerRuntime());
  const shutdown = (): void => {
    runtime.executor.cancelAll();
    runtime.server.close(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

void main().catch(() => {
  console.error("ADE host runner could not start.");
  process.exitCode = 1;
});
