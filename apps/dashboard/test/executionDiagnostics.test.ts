import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExecutionFailureDetails } from "../src/components/ExecutionFailureDetails.js";
import { diagnosticFromLog, readExecutionDiagnostic } from "../src/lib/executionDiagnostics.js";

test("renders the failed step, true code, command, exit code and redacted stderr separately", () => {
  const diagnostic = readExecutionDiagnostic({ event: "task.execution.failed", taskId: "task", stage: "Provision checkout",
    code: "GIT_CLONE_FAILED", errorType: "ProjectProvisioningError", command: "git clone [arguments omitted]", exitCode: 128,
    message: "Clone failed", stderr: "fatal: repository not found Authorization: Bearer private-value", stack: "at /home/operator/private/file.ts" }, "task");
  assert.ok(diagnostic);
  const html = renderToStaticMarkup(createElement(ExecutionFailureDetails, { diagnostic }));
  for (const text of ["Provision checkout", "GIT_CLONE_FAILED", "git clone", "128", "repository not found", "Technical details"]) assert.ok(html.includes(text));
  assert.match(html, /<details><summary>Technical details/);
  assert.doesNotMatch(html, /private-value|operator\/private/);
});

test("rejects unrelated or malformed diagnostics and does not expose extra metadata", () => {
  assert.equal(diagnosticFromLog("broken JSON", "task"), null);
  assert.equal(readExecutionDiagnostic({ event: "task.execution.failed", taskId: "other" }, "task"), null);
  const diagnostic = readExecutionDiagnostic({ event: "task.execution.failed", taskId: "task", env: { SECRET: "hidden" }, stderr: "x".repeat(10000) }, "task");
  assert.ok(diagnostic);
  assert.ok(diagnostic.stderr.length <= 1800);
  assert.doesNotMatch(JSON.stringify(diagnostic), /hidden|SECRET/);
});
