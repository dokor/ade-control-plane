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
  assert.equal(actions[0]?.[0], "clone");
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
