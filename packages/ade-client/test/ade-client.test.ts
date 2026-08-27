import assert from "node:assert/strict";
import test from "node:test";

import {
  ADE_PROTOCOL_VERSION,
  AdeClientError,
  DeterministicFakeAdeClient,
  LocalProcessAdeClient,
  type AdeCapabilities,
  type AdeProcessExecutor,
  type AdeProjectRef,
} from "../src/index.js";

const project: AdeProjectRef = {
  projectId: "project-alpha",
  projectRef: "alpha",
  repository: "dokor/alpha",
};

const capabilities: AdeCapabilities = {
  adeVersion: "0.4.0",
  observedAt: "2026-08-27T08:00:00.000Z",
  operations: ["capabilities", "status", "runnable-work", "advance", "apply-decision", "reconcile"],
  protocolVersion: ADE_PROTOCOL_VERSION,
};

function envelope(operation: string, value: unknown): string {
  return JSON.stringify({ operation, protocolVersion: ADE_PROTOCOL_VERSION, value });
}

class StubExecutor implements AdeProcessExecutor {
  public readonly calls: Array<{ args: readonly string[]; command: string }> = [];

  public constructor(private readonly response: { exitCode: number; stdout: string }) {}

  public async execute(command: string, args: readonly string[]): Promise<{ exitCode: number; stdout: string }> {
    this.calls.push({ args, command });
    return this.response;
  }
}

test("fake ADE implements the complete control-plane contract deterministically", async () => {
  const fake = new DeterministicFakeAdeClient({
    [project.projectId]: {
      advanceByExecutionId: {
        "execution-1": {
          controlPlaneExecutionId: "execution-1",
          state: "succeeded",
          summary: "work completed",
        },
      },
      capabilities,
      decisionResult: { decisionRef: "decision-1", state: "applied" },
      reconciliationByExecutionId: {
        "execution-1": { controlPlaneExecutionId: "execution-1", state: "succeeded" },
      },
      runnableWork: { ref: "work-1", summary: "Persist project registry" },
      status: {
        capabilities,
        currentWork: { ref: "work-1", summary: "Persist project registry" },
        observedAt: "2026-08-27T08:00:00.000Z",
        projectId: project.projectId,
        state: "ready",
      },
    },
  });

  assert.equal((await fake.getStatus(project)).state, "ready");
  assert.equal((await fake.getRunnableWork(project))?.ref, "work-1");
  assert.equal((await fake.advance(project, { controlPlaneExecutionId: "execution-1" })).state, "succeeded");
  assert.equal((await fake.applyHumanDecision(project, { actorRef: "github:dokor", decisionRef: "decision-1", option: "approve" })).state, "applied");
  assert.equal((await fake.reconcileExecution(project, "execution-1")).state, "succeeded");
  assert.deepEqual(fake.getRequests().map(({ operation }) => operation), ["status", "runnable-work", "advance", "apply-decision", "reconcile"]);
});

test("local process adapter uses typed arguments and normalizes a status envelope", async () => {
  const executor = new StubExecutor({
    exitCode: 0,
    stdout: envelope("status", {
      capabilities,
      observedAt: "2026-08-27T08:00:00.000Z",
      projectId: project.projectId,
      state: "waiting-human",
      waitingReason: "approval required",
    }),
  });
  const client = new LocalProcessAdeClient({ command: "ade", executor, timeoutMs: 500 });

  const status = await client.getStatus(project);

  assert.equal(status.state, "waiting-human");
  assert.deepEqual(executor.calls[0], {
    args: ["control-plane", "status", "--project", "alpha", "--json"],
    command: "ade",
  });
});

test("rejects unknown ADE output fields without returning raw output", async () => {
  const secret = "ghp_synthetic_secret_should_not_escape";
  const executor = new StubExecutor({
    exitCode: 0,
    stdout: envelope("status", {
      capabilities,
      observedAt: "2026-08-27T08:00:00.000Z",
      projectId: project.projectId,
      state: "ready",
      unexpected: secret,
    }),
  });
  const client = new LocalProcessAdeClient({ command: "ade", executor });

  await assert.rejects(
    client.getStatus(project),
    (error: unknown) =>
      error instanceof AdeClientError &&
      error.code === "ADE_OUTPUT_INVALID" &&
      !error.message.includes(secret),
  );
});

test("classifies an ambiguous advance transport failure for reconciliation", async () => {
  const executor = new StubExecutor({ exitCode: 1, stdout: "provider token: synthetic-secret" });
  const client = new LocalProcessAdeClient({ command: "ade", executor });

  await assert.rejects(
    client.advance(project, { controlPlaneExecutionId: "execution-unknown" }),
    (error: unknown) =>
      error instanceof AdeClientError &&
      error.code === "ADE_PROCESS_EXITED" &&
      error.retryClassification === "reconcile-first" &&
      !error.message.includes("synthetic-secret"),
  );
});

test("requires reconciliation when advance returns malformed output", async () => {
  const executor = new StubExecutor({ exitCode: 0, stdout: "not-json" });
  const client = new LocalProcessAdeClient({ command: "ade", executor });

  await assert.rejects(
    client.advance(project, { controlPlaneExecutionId: "execution-unknown" }),
    (error: unknown) =>
      error instanceof AdeClientError &&
      error.code === "ADE_OUTPUT_INVALID" &&
      error.retryClassification === "reconcile-first",
  );
});
