import assert from "node:assert/strict";
import test from "node:test";

import type { RunnerRequest } from "@ade-control-plane/runner-protocol";

import { UnixRunnerControlPlaneClient } from "../src/UnixRunnerControlPlaneClient.js";

const project = { projectId: "project-alpha", projectRef: "alpha", repository: "dokor/alpha" };

test("sends a strict typed runnable-work request over the runner transport", async () => {
  let captured: RunnerRequest | undefined;
  const client = new UnixRunnerControlPlaneClient({
    socketPath: "/run/ade-control-plane-runner/runner.sock",
    sharedSecret: "test-secret",
    projects: { "project-alpha": { workspaceRef: "primary", leaseId: "lease-1", leaseKey: "key-1" } },
    send: async (_socketPath, request) => {
      captured = request;
      return {
        protocolVersion: "1", requestId: request.requestId, executionId: request.executionId,
        runnerId: "raspberry-local", status: "succeeded",
        result: { ref: "work-1", summary: "Implement runner" },
      };
    },
  });

  const work = await client.getRunnableWork(project);

  assert.equal(work?.ref, "work-1");
  assert.equal(captured?.capability, "ade.runnable-work");
  assert.deepEqual(captured?.input, { projectRef: "alpha" });
  assert.equal(captured?.workspaceRef, "primary");
  assert.equal(Object.hasOwn(captured?.input as object, "command"), false);
});

test("does not turn an unknown runner outcome into a completed operation", async () => {
  const client = new UnixRunnerControlPlaneClient({
    socketPath: "/run/ade-control-plane-runner/runner.sock",
    sharedSecret: "test-secret",
    projects: { "project-alpha": { workspaceRef: "primary", leaseId: "lease-1", leaseKey: "key-1" } },
    send: async (_socketPath, request) => ({
      protocolVersion: "1", requestId: request.requestId, executionId: request.executionId,
      runnerId: "raspberry-local", status: "unknown",
    }),
  });

  await assert.rejects(client.reconcile(project, "execution-1"), /reconciliation is required/);
});
