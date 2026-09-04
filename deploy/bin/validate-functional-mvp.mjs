#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const scenarios = ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08", "F09"];
const text = (value, max = 500) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const keys = (value, allowed) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).every((key) => allowed.includes(key)) && allowed.every((key) => Object.hasOwn(value, key));
const sha = (value) => typeof value === "string" && /^[a-f0-9]{40,64}$/i.test(value);
const safeUrl = (value) => {
  try { const url = new URL(value); return text(value) && url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash; } catch { return false; }
};

export function validateEvidence(report) {
  const fail = (message) => { throw new Error(message); };
  if (!keys(report, ["schemaVersion", "gateIssue", "scope", "runId", "operator", "environment", "verdict", "scenarios"]) || report.schemaVersion !== 2 || report.gateIssue !== 153 || report.scope !== "functional-mvp") fail("Expected the functional MVP schema v2 for issue 153.");
  if (!text(report.runId, 200) || !text(report.operator, 200)) fail("Run and operator identity are required.");
  const env = report.environment;
  if (!keys(env, ["deployedSha", "defaultBranchSha", "runtimeVersion", "dashboardUrl", "repository", "projectId"])
    || !sha(env.deployedSha) || !sha(env.defaultBranchSha) || !text(env.runtimeVersion, 100) || !safeUrl(env.dashboardUrl)
    || !/^[\w.-]+\/[\w.-]+$/.test(env.repository) || !/^[a-f0-9-]{36}$/i.test(env.projectId)) fail("Missing or malformed deployment/project evidence.");
  if (!Array.isArray(report.scenarios) || report.scenarios.length !== scenarios.length
    || new Set(report.scenarios.map((entry) => entry.id)).size !== scenarios.length
    || report.scenarios.some((entry) => !scenarios.includes(entry.id))) fail("Exactly one F01-F09 entry is required; operational soak cannot substitute for product evidence.");
  for (const entry of report.scenarios) {
    if (!keys(entry, ["id", "status", "executedAt", "evidence", "notes"]) || !["passed", "failed", "blocked", "not-run"].includes(entry.status)
      || typeof entry.notes !== "string" || entry.notes.length > 1000 || !Array.isArray(entry.evidence) || entry.evidence.length > 30
      || entry.evidence.some((ref) => !text(ref) || (ref.includes("://") && !safeUrl(ref)))) fail("Malformed scenario or unsafe evidence reference.");
    if (entry.status === "passed" && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(entry.executedAt) || !Number.isFinite(Date.parse(entry.executedAt)) || entry.evidence.length === 0)) fail("Passed scenarios require a timestamp and evidence references.");
  }
  const serialized = JSON.stringify(report);
  if (/gh[pousr]_[A-Za-z0-9]+|github_pat_|sk-[A-Za-z0-9]{8,}|BEGIN.*PRIVATE KEY|Bearer\s|(?:password|token|secret)\s*[:=]/i.test(serialized)) fail("Secret-shaped content is forbidden.");
  if (report.verdict !== "passed" || report.scenarios.some((entry) => entry.status !== "passed")) fail("Functional MVP is not passed. Keep failed, blocked and unexecuted steps visible.");
  return "Functional MVP ledger structurally valid: 9/9 evidence-backed operator claims. Real execution and human sign-off remain required; #88 soak is separate.";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2] || (await stat(process.argv[2])).size > 262144) throw new Error("Provide an evidence file of at most 256 KiB.");
    console.log(validateEvidence(JSON.parse(await readFile(process.argv[2], "utf8"))));
  } catch { console.error("Functional MVP evidence rejected; verify schema, completeness and redaction. No evidence content was printed."); process.exitCode = 1; }
}
