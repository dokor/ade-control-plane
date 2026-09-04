import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectRecord } from "@ade-control-plane/database";
import { GithubAppGitRunner } from "../src/v0/GithubAppGitRunner.js";
import type { CommandInput } from "../src/v0/CommandRunner.js";
import { NodeCommandRunner } from "../src/v0/CommandRunner.js";

const project: ProjectRecord = { id: "p", slug: "alpha", name: "Alpha", repositoryOwner: "dokor", repositoryName: "alpha", repositoryId: "123", state: "enabled", priority: 50, adeAdapter: "local", runnerPolicy: {}, configuration: { v0: { checkout: "alpha", baseBranch: "main" } }, createdAt: "", updatedAt: "" };
const ok = { exitCode: 0, signal: null, stdout: "", stderr: "" };
const secret = "test-installation-credential";

test("Git authentication accepts only a live registered execution workspace", async () => {
  let active = true;
  let calls = 0;
  const runner = new GithubAppGitRunner({ projectRoot: ".", projects: { list: async () => [project] }, installationId: "42",
    resolveExecutionProject: () => active ? project : undefined,
    tokens: { getRepositoryToken: async () => secret }, commands: { run: async (input) => {
      calls++; assert.ok(input.args.includes("https://github.com/dokor/alpha.git")); return ok;
    } },
  });
  const input = { executable: "git", args: ["push", "--set-upstream", "origin", "ade/execution"], cwd: process.cwd() };
  await runner.run(input);
  active = false;
  await assert.rejects(runner.run(input), /registered repository/);
  assert.equal(calls, 1);
});

test("HTTPS credentials cover preflight, clone, fetch and push, but not agent/local Git commands", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ade-app-git-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "alpha"));
  const calls: CommandInput[] = [];
  let tokens = 0;
  const runner = new GithubAppGitRunner({ projectRoot: root, projects: { list: async () => [project] }, installationId: "42",
    tokens: { getRepositoryToken: async (installation, repository) => { assert.equal(installation, "42"); assert.equal(repository, "alpha"); tokens++; return secret; } },
    commands: { run: async (input) => { calls.push(input); return ok; } },
  });
  for (const args of [
    ["ls-remote", "--exit-code", "--heads", "git@github.com:dokor/alpha.git", "refs/heads/main"],
    ["clone", "--branch", "main", "--single-branch", "git@github.com:dokor/alpha.git", join(root, "alpha")],
    ["fetch", "--prune", "origin", "main"],
    ["push", "--set-upstream", "origin", "ade/task"],
    ["-c", "core.hooksPath=/dev/null", "ls-remote", "origin", "refs/heads/ade/task"],
  ]) await runner.run({ executable: "git", args, cwd: join(root, "alpha"), env: { PATH: "test", GIT_TRACE: "1", GIT_SSH: "old-ssh" } });
  for (const call of calls) {
    assert.ok(call.args.includes("https://github.com/dokor/alpha.git"));
    assert.ok(!JSON.stringify(call.args).includes(secret));
    assert.equal(call.env?.GIT_TRACE, undefined);
    assert.equal(call.env?.GIT_SSH, undefined);
    assert.equal(call.env?.GIT_TERMINAL_PROMPT, "0");
    assert.ok(Object.values(call.env!).includes(`Authorization: Basic ${Buffer.from(`x-access-token:${secret}`).toString("base64")}`));
  }
  assert.ok(calls[1]!.args.includes("--no-checkout"));
  assert.ok(calls[2]!.args.includes("+refs/heads/main:refs/remotes/origin/main"));
  for (const executable of ["codex", "ade", "claude"]) await runner.run({ executable, args: ["exec"], cwd: root, env: {} });
  await runner.run({ executable: "git", args: ["commit", "-m", "work"], cwd: root, env: {} });
  assert.equal(tokens, 5);
  for (const call of calls.slice(5)) assert.deepEqual(call.env, {});
});

test("redacts raw and encoded credentials before callbacks and diagnostic results", async () => {
  const encoded = Buffer.from(`x-access-token:${secret}`).toString("base64");
  const output: string[] = [];
  const runner = new GithubAppGitRunner({ projectRoot: ".", projects: { list: async () => [project] }, installationId: "42",
    tokens: { getRepositoryToken: async () => secret }, commands: { run: async (input) => {
      await input.onOutput?.({ stream: "stderr", message: `${secret} ${encoded}` });
      return { ...ok, stderr: `${secret} ${encoded}`, stdout: secret };
    } },
  });
  const result = await runner.run({ executable: "git", args: ["ls-remote", "git@github.com:dokor/alpha.git"], cwd: ".", onOutput: ({ message }) => { output.push(message); } });
  assert.doesNotMatch(JSON.stringify([result, output]), new RegExp(`${secret}|${encoded}`));
});

test("unregistered repositories and token generation failures fail closed with safe App guidance", async () => {
  let commands = 0;
  const runner = new GithubAppGitRunner({ projectRoot: ".", projects: { list: async () => [project] }, installationId: "42",
    tokens: { getRepositoryToken: async () => { throw new Error(secret); } },
    commands: { run: async () => { commands++; return ok; } },
  });
  for (const repository of ["other/private", "dokor/alpha"]) {
    await assert.rejects(runner.run({ executable: "git", args: ["ls-remote", `https://github.com/${repository}.git`], cwd: "." }), (error: any) => {
      assert.equal(error.code, "GIT_AUTH_FAILED");
      assert.match(error.message, /GitHub App HTTPS/);
      assert.ok(!error.message.includes(secret));
      return true;
    });
  }
  assert.equal(commands, 0);
});

test("real Git reads the process-only header for this repository, not another one", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ade-app-header-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = new NodeCommandRunner();
  const runner = new GithubAppGitRunner({ projectRoot: root, projects: { list: async () => [project] }, installationId: "42",
    tokens: { getRepositoryToken: async () => secret }, commands: { run: async (input) => {
      const intended = await git.run({ ...input, args: ["config", "--get-urlmatch", "http.extraHeader", "https://github.com/dokor/alpha.git/info/refs"] });
      assert.equal(intended.exitCode, 0);
      assert.match(intended.stdout, /Authorization: Basic /);
      const other = await git.run({ ...input, args: ["config", "--get-urlmatch", "http.extraHeader", "https://github.com/dokor/beta.git"] });
      assert.doesNotMatch(other.stdout, /Authorization/);
      const later = await git.run({ executable: "git", args: ["config", "--get-urlmatch", "http.extraHeader", "https://github.com/dokor/alpha.git"], cwd: root, env: { PATH: process.env.PATH ?? "", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
      assert.doesNotMatch(later.stdout, /Authorization/);
      return ok;
    } },
  });
  await runner.run({ executable: "git", args: ["ls-remote", "https://github.com/dokor/alpha.git"], cwd: root, env: { PATH: process.env.PATH ?? "" } });
});

test("rejected credentials and transport exceptions never expose token details", async () => {
  for (const throws of [false, true]) {
    const runner = new GithubAppGitRunner({ projectRoot: ".", projects: { list: async () => [project] }, installationId: "42",
      tokens: { getRepositoryToken: async () => secret }, commands: { run: async () => {
        if (throws) throw new Error(secret);
        return { ...ok, exitCode: 128, stderr: `Authentication failed ${secret}` };
      } },
    });
    await assert.rejects(runner.run({ executable: "git", args: ["ls-remote", "https://github.com/dokor/alpha.git"], cwd: "." }), (error: any) => {
      assert.ok(!error.message.includes(secret));
      assert.match(error.message, /GitHub App HTTPS/);
      if (!throws) assert.equal(error.code, "GIT_AUTH_FAILED");
      return true;
    });
  }
});
