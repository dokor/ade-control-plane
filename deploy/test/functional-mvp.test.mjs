import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { scenarios, validateEvidence } from "../bin/validate-functional-mvp.mjs";

// Synthetic unit fixture only, never release evidence.
const fixture = () => ({ schemaVersion: 2, gateIssue: 153, scope: "functional-mvp", runId: "unit-fixture", operator: "test",
  environment: { deployedSha: "a".repeat(40), defaultBranchSha: "b".repeat(40), runtimeVersion: "test", dashboardUrl: "https://dashboard.example.test", repository: "test/project", projectId: "11111111-1111-4111-8111-111111111111" },
  verdict: "passed", scenarios: scenarios.map((id) => ({ id, status: "passed", executedAt: "2026-09-04T10:00:00Z", evidence: ["synthetic-unit-reference"], notes: "" })) });
test("functional scope does not require operational soak", () => assert.match(validateEvidence(fixture()), /9\/9/));
for (const status of ["not-run", "failed", "blocked"]) test(`rejects ${status} product evidence`, () => { const report = fixture(); report.scenarios[0].status = status; assert.throws(() => validateEvidence(report)); });
test("rejects missing, duplicate, operational and unevidenced scenarios", () => {
  for (const mutate of [(r) => r.scenarios.pop(), (r) => r.scenarios[0].id = "F02", (r) => r.scenarios[0].id = "S14", (r) => r.scenarios[0].evidence = []]) { const report = fixture(); mutate(report); assert.throws(() => validateEvidence(report)); }
});
test("rejects raw payload fields, credential URLs and secret-shaped notes", () => {
  for (const mutate of [(r) => r.prompt = "raw", (r) => r.environment.dashboardUrl = "https://user:password@example.test", (r) => r.scenarios[0].evidence = ["https://example.test/?token=private"], (r) => r.scenarios[0].notes = "token=private"]) { const report = fixture(); mutate(report); assert.throws(() => validateEvidence(report)); }
});
test("published template cannot qualify a release", async () => {
  const report = JSON.parse(await readFile(new URL("../../docs/functional-mvp-evidence.template.json", import.meta.url), "utf8"));
  assert.throws(() => validateEvidence(report));
});
