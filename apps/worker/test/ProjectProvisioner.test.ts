import { strict as assert } from "node:assert";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { provisionRegisteredProjects } from "../src/v0/ProjectProvisioner.js";
import type { AuditEventRecord } from "@ade-control-plane/database";

const project = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "alpha",
  name: "Alpha",
  repositoryOwner: "dokor",
  repositoryName: "alpha",
  repositoryId: "123",
  state: "disabled" as const,
  priority: 50,
  adeAdapter: "github-work",
  runnerPolicy: {},
  configuration: { v0: { checkout: "alpha", baseBranch: "main" } },
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
};

test("clones a registered project under the configured root and verifies its remote", async () => {
  const root = await mkdtemp(join(tmpdir(), "ade-provision-"));
  const actions: string[][] = [];
  const audits: string[] = [];
  await provisionRegisteredProjects({
    persistence: { projects: { list: async () => [project] }, auditEvents: { append: async (event) => { audits.push(event.action); return { ...event, id: "audit-1" } as AuditEventRecord; } } },
    commands: { run: async (input) => { actions.push([...input.args]); if (input.args[0] === "clone") await mkdir(input.args.at(-1)!, { recursive: true }); return { exitCode: 0, signal: null, stdout: input.args[0] === "clone" ? "" : "git@github.com:dokor/alpha.git", stderr: "" }; } },
    projectRoot: root,
    gitEnvironment: {},
  });
  assert.deepEqual(actions[0], ["ls-remote", "--exit-code", "--heads", "git@github.com:dokor/alpha.git", "refs/heads/main"]);
  assert.equal(actions[1]?.[0], "clone");
  assert.deepEqual(audits, ["project.checkout.ready"]);
});

test("does not accept a checkout with a different remote", async () => {
  const root = await mkdtemp(join(tmpdir(), "ade-provision-"));
  await mkdir(join(root, "alpha"));
  const audits: string[] = [];
  await provisionRegisteredProjects({
    persistence: { projects: { list: async () => [project] }, auditEvents: { append: async (event) => { audits.push(event.action); return { ...event, id: "audit-1" } as AuditEventRecord; } } },
    commands: { run: async () => ({ exitCode: 0, signal: null, stdout: "git@github.com:other/repository.git", stderr: "" }) },
    projectRoot: root,
    gitEnvironment: {},
  });
  assert.deepEqual(audits, ["project.checkout.failed"]);
});

test("records a safe clone failure reason without persisting Git output", async () => {
  const root = await mkdtemp(join(tmpdir(), "ade-provision-"));
  const events: AuditEventRecord[] = [];
  await provisionRegisteredProjects({
    persistence: { projects: { list: async () => [project] }, auditEvents: { append: async (event) => { events.push(event as AuditEventRecord); return { ...event, id: "audit-1" } as AuditEventRecord; } } },
    commands: { run: async () => ({ exitCode: 1, signal: null, stdout: "", stderr: "private failure" }) }, projectRoot: root, gitEnvironment: {},
  });
  assert.equal(events[0]?.metadata.reason, "GIT_PREFLIGHT_FAILED");
});

test("preflight reports an absent base branch and does not clone", async () => {
  const root = await mkdtemp(join(tmpdir(), "ade-provision-"));
  const events: AuditEventRecord[] = []; const calls: string[] = [];
  await provisionRegisteredProjects({
    persistence: { projects: { list: async () => [project] }, auditEvents: { append: async (event) => { events.push(event as AuditEventRecord); return { ...event, id: "audit" } as AuditEventRecord; } } },
    commands: { run: async (input) => { calls.push(input.args[0]!); assert.ok(input.signal); return { exitCode: 2, signal: null, stdout: "", stderr: "" }; } },
    projectRoot: root, gitEnvironment: {},
  });
  assert.deepEqual(calls, ["ls-remote"]);
  assert.equal(events[0]?.metadata.reason, "GIT_BRANCH_NOT_FOUND");
});

for (const [stderr, code] of [
  ["Host key verification failed.", "HOST_KEY_VERIFICATION_FAILED"],
  ["WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!", "HOST_KEY_VERIFICATION_FAILED"],
  ["Permission denied (publickey).", "GIT_AUTH_FAILED"],
  ["Authentication failed", "GIT_AUTH_FAILED"],
  ["ERROR: Repository not found.", "REPOSITORY_NOT_FOUND"],
  ["Permission to owner/repo denied to user.", "REPOSITORY_ACCESS_DENIED"],
  ["Could not resolve hostname github.com", "GIT_NETWORK_FAILED"],
  ["Connection timed out", "GIT_NETWORK_FAILED"],
  ["Unclassified error", "GIT_PREFLIGHT_FAILED"],
] as const) for (const stage of ["ls-remote", "clone"] as const) test(`classifies ${stage} failure as ${code}`, async () => {
  const root = await mkdtemp(join(tmpdir(), "ade-provision-"));
  const events: AuditEventRecord[] = []; const calls: string[] = [];
  await provisionRegisteredProjects({
    persistence: { projects: { list: async () => [project] }, auditEvents: { append: async (event) => { events.push(event as AuditEventRecord); return { ...event, id: "audit" } as AuditEventRecord; } } },
    commands: { run: async (input) => { calls.push(input.args[0]!); return { exitCode: input.args[0] === stage ? 128 : 0, signal: null, stdout: "", stderr: `${stderr} ghp_neverPersist secret=private-value` }; } },
    projectRoot: root, gitEnvironment: {},
  });
  assert.equal(events[0]?.metadata.reason, stage === "clone" && code === "GIT_PREFLIGHT_FAILED" ? "GIT_CLONE_FAILED" : code);
  assert.equal(events[0]?.metadata.host, "github.com");
  assert.doesNotMatch(JSON.stringify(events), /ghp_neverPersist|private-value/);
  if (stage === "ls-remote") assert.deepEqual(calls, ["ls-remote"]);
});
