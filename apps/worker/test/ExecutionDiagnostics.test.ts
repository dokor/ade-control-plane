import assert from "node:assert/strict";
import test from "node:test";
import { NodeCommandRunner } from "../src/v0/CommandRunner.js";
import { diagnosticCommands, executionStage, failureDiagnostic, redactCommandOutput, redactDiagnostic, withExecutionDiagnostics } from "../src/v0/ExecutionDiagnostics.js";

test("real spawn failure preserves ENOENT without recording argv or stdin", async () => {
  await withExecutionDiagnostics([], async () => {
    executionStage("Run Codex");
    try {
      await diagnosticCommands(new NodeCommandRunner()).run({ executable: "nonexistent-ade-test-executable-177", args: ["exec", "sensitive-argument"], cwd: process.cwd(), stdin: "sensitive-prompt" });
      assert.fail("Expected spawn failure");
    } catch (error) {
      const diagnostic = failureDiagnostic("task", "project", "EXECUTION_FAILED", error);
      assert.equal(diagnostic.internalCode, "ENOENT");
      assert.equal(diagnostic.exitCode, null);
      assert.doesNotMatch(JSON.stringify(diagnostic), /sensitive-argument|sensitive-prompt/);
    }
  });
});

test("diagnostic JSON is bounded, redacted and reset between stages/tasks", async () => {
  await withExecutionDiagnostics(["unstructured-secret"], async () => {
    assert.equal(redactCommandOutput("stderr", "-----BEGIN PRIVATE KEY-----"), "[redacted-key]");
    assert.equal(redactCommandOutput("stderr", "private-base64-content"), "[redacted-key]");
    assert.equal(redactCommandOutput("stderr", "-----END PRIVATE KEY-----"), "[redacted-key]");
    assert.equal(redactCommandOutput("stderr", "useful error"), "useful error");
    assert.doesNotMatch(redactDiagnostic('Authorization: Bearer bearer-secret api_key="quoted secret" https://user:pass@example.org unstructured-secret'), /bearer-secret|quoted secret|user:pass|unstructured-secret/);
    const commands = diagnosticCommands({ run: async () => ({ exitCode: 1, signal: "SIGTERM", stdout: "", stderr: "é\n\"".repeat(10000) }) });
    await commands.run({ executable: "git", args: ["clone", "secret-url"], cwd: "/" });
    const diagnostic = failureDiagnostic("task", "project", "GIT_CLONE_FAILED", new Error("failure"));
    assert.ok(Buffer.byteLength(JSON.stringify(diagnostic)) <= 3500);
    assert.equal(diagnostic.signal, "SIGTERM");
    executionStage("Create PR");
    assert.equal(failureDiagnostic("task", "project", "FAILED", new Error()).exitCode, null);
  });
  assert.equal(failureDiagnostic("other", "project", "FAILED", new Error()).command, "No command was started");
});
