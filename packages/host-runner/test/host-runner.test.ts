import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  sendUnixRunnerRequest,
  type RunnerRequest,
} from "@ade-control-plane/runner-protocol";

import { loadHostRunnerRuntime, startHostRunner, type HostRunnerRuntimeConfig } from "../src/index.js";

const now = "2026-08-28T10:00:00.000Z";

test("executes ade.status over the authenticated UDS with a runner-owned workspace", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ade-host-runner-"));
  const root = join(directory, "project");
  const workspace = join(root, "workspace");
  const socketPath = process.platform === "win32"
    ? `\\\\.\\pipe\\ade-host-runner-${process.pid}-${Date.now()}`
    : join(directory, "runner.sock");
  try {
    await mkdir(workspace, { recursive: true });
    const fakeAde = join(directory, "fake-ade.mjs");
    await writeFile(fakeAde, `
      const operation = process.argv[3];
      process.stdout.write(JSON.stringify({ operation, protocolVersion: "1", value: {
        projectId: "project-alpha", state: "ready", observedAt: "${now}",
        capabilities: { protocolVersion: "1", adeVersion: "test", observedAt: "${now}", operations: ["status"] }
      } }));
    `, "utf8");
    const runtime: HostRunnerRuntimeConfig = {
      runnerId: "test-runner", socketPath, sharedSecret: "test-shared-secret",
      maxOutputBytes: 4096, maxTimeoutMs: 15_000,
      ade: { command: process.execPath, baseArgs: [fakeAde] },
      projects: {
        "project-alpha": {
          root, projectRef: "alpha", capabilities: ["ade.status"], workspaces: { primary: "workspace" },
        },
      },
    };
    const started = await startHostRunner(runtime);
    try {
      const response = await sendUnixRunnerRequest(socketPath, request(), runtime.sharedSecret);
      assert.equal(response.status, "succeeded");
      assert.equal((response.result as { state: string }).state, "ready");

      const rejected = await sendUnixRunnerRequest(socketPath, request({ requestId: "workspace", nonce: "workspace", workspaceRef: "../project" }), runtime.sharedSecret);
      assert.equal(rejected.status, "rejected");
      assert.equal(rejected.error?.code, "WORKSPACE_NOT_ALLOWED");
    } finally {
      started.executor.cancelAll();
      await new Promise<void>((resolve) => started.server.close(() => resolve()));
    }
  } finally {
    await removeTestDirectory(directory);
  }
});

test("canonicalizes configured roots and refuses raw workspace paths in host configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ade-host-runner-config-"));
  const root = join(directory, "project");
  const configPath = join(directory, "runner.json");
  const secretPath = join(directory, "secret");
  try {
    await mkdir(join(root, "workspace"), { recursive: true });
    await writeFile(secretPath, "runner-secret", "utf8");
    await writeFile(configPath, JSON.stringify({
      runnerId: "test", socketPath: join(directory, "runner.sock"),
      ade: { command: process.execPath },
      projects: {
        alpha: { root, projectRef: "alpha", capabilities: ["ade.status"], workspaces: { primary: "workspace" } },
      },
    }), "utf8");
    const runtime = await loadHostRunnerRuntime({ RUNNER_CONFIG_FILE: configPath, RUNNER_AUTH_SECRET_FILE: secretPath });
    assert.equal(runtime.projects.alpha?.root, await import("node:fs/promises").then(({ realpath }) => realpath(root)));
    assert.equal(runtime.projects.alpha?.workspaces?.primary, "workspace");

    await writeFile(configPath, JSON.stringify({
      runnerId: "test", socketPath: join(directory, "runner.sock"), ade: { command: process.execPath },
      projects: { alpha: { root, projectRef: "alpha", capabilities: ["ade.status"], workspaces: { primary: root } } },
    }), "utf8");
    await assert.rejects(loadHostRunnerRuntime({ RUNNER_CONFIG_FILE: configPath, RUNNER_AUTH_SECRET_FILE: secretPath }), /absolute workspace reference/);
  } finally {
    await removeTestDirectory(directory);
  }
});

function request(overrides: Partial<RunnerRequest> = {}): RunnerRequest {
  const issuedAt = new Date(Date.now() - 1_000).toISOString();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  return {
    protocolVersion: "1", requestId: "request-1", executionId: "execution-1", projectId: "project-alpha",
    capability: "ade.status", workspaceRef: "primary", issuedAt,
    expiresAt, nonce: "nonce-1", lease: { leaseId: "lease-1", leaseKey: "key-1" },
    limits: { timeoutMs: 10_000, maxOutputBytes: 4_096 }, input: { projectRef: "alpha" }, ...overrides,
  };
}

async function removeTestDirectory(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true, maxRetries: 1, retryDelay: 25 });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBUSY" || attempt === 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
