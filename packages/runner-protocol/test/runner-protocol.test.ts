import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SecureRunner, signRunnerRequest, type RunnerRequest } from "../src/index.js";

const now = "2026-08-27T10:00:00.000Z";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "ade-runner-root-"));
  await mkdir(join(root, "workspace"));
  let calls = 0;
  const runner = new SecureRunner({
    runnerId: "raspberry-local",
    sharedSecret: "dedicated-test-secret",
    projects: { alpha: { root, capabilities: ["ade.status"] } },
    now: () => new Date(now),
    executor: { execute: async () => { calls += 1; return { status: "succeeded", result: { safe: true } }; } },
  });
  return { root, runner, calls: () => calls };
}

function request(overrides: Partial<RunnerRequest> = {}): RunnerRequest {
  return {
    protocolVersion: "1", requestId: "request-1", executionId: "execution-1", projectId: "alpha",
    capability: "ade.status", workspaceRef: "workspace", issuedAt: "2026-08-27T09:59:00.000Z",
    expiresAt: "2026-08-27T10:01:00.000Z", nonce: "nonce-1", lease: { leaseId: "lease-1", leaseKey: "alpha:1" },
    limits: { timeoutMs: 1_000 }, input: { projectRef: "alpha" }, ...overrides,
  };
}

test("accepts an authenticated typed request and rejects replay", async () => {
  const context = await setup(); const first = request(); const signature = signRunnerRequest(first, "dedicated-test-secret");
  assert.equal((await context.runner.handle(first, signature)).status, "succeeded");
  assert.equal((await context.runner.handle(first, signature)).error?.code, "REQUEST_REPLAYED");
  assert.equal(context.calls(), 1);
});

test("rejects invalid signatures, expiry, project, and capability before execution", async () => {
  const context = await setup();
  assert.equal((await context.runner.handle(request(), "bad")).error?.code, "AUTHENTICATION_FAILED");
  const expired = request({ requestId: "expired", nonce: "expired", expiresAt: "2026-08-27T09:00:00.000Z" });
  assert.equal((await context.runner.handle(expired, signRunnerRequest(expired, "dedicated-test-secret"))).error?.code, "REQUEST_EXPIRED");
  const project = request({ requestId: "project", nonce: "project", projectId: "other" });
  assert.equal((await context.runner.handle(project, signRunnerRequest(project, "dedicated-test-secret"))).error?.code, "PROJECT_NOT_ALLOWED");
  const capability = request({ requestId: "cap", nonce: "cap", capability: "ade.advance" });
  assert.equal((await context.runner.handle(capability, signRunnerRequest(capability, "dedicated-test-secret"))).error?.code, "CAPABILITY_NOT_ALLOWED");
  assert.equal(context.calls(), 0);
});

test("rejects traversal and symlink workspace escapes before execution", async (t) => {
  const context = await setup(); const outside = await mkdtemp(join(tmpdir(), "ade-runner-outside-"));
  try { await symlink(outside, join(context.root, "escape")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") { t.skip("Windows symlink creation requires developer mode or elevation."); return; } throw error; }
  const traversal = request({ requestId: "traversal", nonce: "traversal", workspaceRef: "../outside" });
  assert.equal((await context.runner.handle(traversal, signRunnerRequest(traversal, "dedicated-test-secret"))).error?.code, "WORKSPACE_CONTAINMENT_FAILED");
  const escaped = request({ requestId: "escape", nonce: "escape", workspaceRef: "escape" });
  assert.equal((await context.runner.handle(escaped, signRunnerRequest(escaped, "dedicated-test-secret"))).error?.code, "WORKSPACE_CONTAINMENT_FAILED");
  assert.equal(context.calls(), 0);
});

test("returns unknown with reconcile-first after an ambiguous executor failure", async () => {
  const context = await setup(); const failing = new SecureRunner({ runnerId: "raspberry-local", sharedSecret: "dedicated-test-secret", projects: { alpha: { root: context.root, capabilities: ["ade.status"] } }, now: () => new Date(now), executor: { execute: async () => { throw new Error("transport lost"); } } });
  const value = request(); const response = await failing.handle(value, signRunnerRequest(value, "dedicated-test-secret"));
  assert.equal(response.status, "unknown"); assert.equal(response.error?.retryability, "reconcile-first");
});
