import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import type { ProjectRecord } from "@ade-control-plane/database";
import { ExecutionWorkspaces } from "../src/v0/ExecutionWorkspaces.js";
import { NodeCommandRunner, type CommandInput } from "../src/v0/CommandRunner.js";

const project: ProjectRecord = { id: "project", slug: "repo", name: "Repo", repositoryOwner: "owner", repositoryName: "repo", repositoryId: "1", state: "enabled", priority: 50, adeAdapter: "local", runnerPolicy: {}, configuration: { v0: { checkout: "shared", baseBranch: "main" } }, createdAt: "", updatedAt: "" };

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "ade-isolation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "shared");
  await mkdir(source);
  const commands = new NodeCommandRunner();
  const env = { PATH: process.env.PATH ?? "", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = async (cwd: string, args: string[]) => {
    const result = await commands.run({ executable: "git", cwd, args: ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], env });
    assert.equal(result.exitCode, 0, result.stderr);
    return result.stdout.trim();
  };
  await git(source, ["init", "-b", "main"]);
  await writeFile(join(source, "README.md"), "baseline\n");
  await git(source, ["add", "."]);
  await git(source, ["commit", "-m", "baseline"]);
  const transport = { run: (input: CommandInput) => {
    const args = input.args.map((arg) => arg === "https://github.com/owner/repo.git" ? source : arg);
    return commands.run({ ...input, args });
  } };
  const options = { projectRoot: root, commands: transport, environment: env };
  return { root, source, git, options, manager: new ExecutionWorkspaces(options) };
}

test("two simultaneous executions have independent clean clones and leave a dirty shared checkout untouched", async (t) => {
  const { manager, source, git } = await fixture(t);
  await writeFile(join(source, "README.md"), "unrelated local work\n");
  const [a, b] = await Promise.all([manager.prepare(project, "a", "task"), manager.prepare(project, "b", "github")]);
  assert.notEqual(a.root, b.root);
  for (const checkout of [a, b]) {
    assert.equal(await git(checkout.root, ["status", "--porcelain"]), "");
    assert.equal(await readFile(join(checkout.root, "README.md"), "utf8"), "baseline\n");
    assert.equal(manager.resolveProject(checkout.root)?.id, project.id);
  }
  await Promise.all([git(a.root, ["switch", "-c", "ade/a"]), git(b.root, ["switch", "-c", "ade/b"])]);
  await writeFile(join(a.root, "README.md"), "execution a\n");
  await git(a.root, ["commit", "-am", "a"]);
  assert.equal(await git(b.root, ["status", "--porcelain"]), "");
  assert.equal(await readFile(join(source, "README.md"), "utf8"), "unrelated local work\n");
  await a.release();
  assert.equal(manager.resolveProject(a.root), undefined);
  assert.equal(await readFile(join(b.root, "README.md"), "utf8"), "baseline\n");
  await b.release();
});

test("failed preparation removes only its generated workspace", async (t) => {
  const { root, options, source } = await fixture(t);
  const manager = new ExecutionWorkspaces({ ...options, commands: { run: async () => ({ exitCode: 128, signal: null, stdout: "", stderr: "failure" }) } });
  await assert.rejects(manager.prepare(project, "failed", "task"), /clone failed/);
  assert.deepEqual(await readdir(join(root, ".ade-executions")), []);
  assert.equal(await readFile(join(source, "README.md"), "utf8"), "baseline\n");
});

test("recovery retains live, unknown and modified-ownership workspaces", async (t) => {
  const { manager, options, root } = await fixture(t);
  const workspace = await manager.prepare(project, "live", "task");
  const recovery = new ExecutionWorkspaces(options);
  await recovery.reclaimAbandoned(async () => true);
  assert.equal(await readFile(join(workspace.root, "README.md"), "utf8"), "baseline\n");
  const directory = (await readdir(join(root, ".ade-executions")))[0]!;
  await writeFile(join(root, ".ade-executions", directory, "owner.json"), "{}");
  await assert.rejects(workspace.release(), /ownership changed/);
  await recovery.reclaimAbandoned(async () => true);
  assert.equal(await readFile(join(workspace.root, "README.md"), "utf8"), "baseline\n");
});

test("pre-aborted preparation does not allocate a workspace", async (t) => {
  const { manager } = await fixture(t);
  await assert.rejects(manager.prepare(project, "cancelled", "task", AbortSignal.abort()));
});

test("recovery reclaims a dead terminal owner but retains a nonterminal owner", async (t) => {
  const { manager, root, options } = await fixture(t);
  await manager.prepare(project, "terminal", "task");
  const directory = (await readdir(join(root, ".ade-executions")))[0]!;
  const path = join(root, ".ade-executions", directory, "owner.json");
  const owner = JSON.parse(await readFile(path, "utf8"));
  const child = spawnSync(process.execPath, ["-e", ""], { windowsHide: true });
  assert.equal(child.status, 0);
  owner.pid = child.pid;
  await writeFile(path, JSON.stringify(owner));
  const recovery = new ExecutionWorkspaces(options);
  await recovery.reclaimAbandoned(async () => false);
  assert.deepEqual(await readdir(join(root, ".ade-executions")), [directory]);
  await recovery.reclaimAbandoned(async (record) => record.executionId === "terminal");
  assert.deepEqual(await readdir(join(root, ".ade-executions")), []);
});
