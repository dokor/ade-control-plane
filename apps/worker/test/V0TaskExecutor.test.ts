import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  ProjectRecord,
  V0TaskLogRecord,
  V0TaskRecord,
} from "@ade-control-plane/database";
import { DeterministicFakeGithubClient } from "@ade-control-plane/github";

import type { CommandInput, CommandResult, CommandRunner } from "../src/v0/CommandRunner.js";
import { V0TaskExecutor } from "../src/v0/V0TaskExecutor.js";

const now = "2026-08-27T10:00:00.000Z";

test("runs Codex through stdin then commits, pushes and persists the PR", async () => {
  const context = await setup();
  try {
    const github = new DeterministicFakeGithubClient();
    const commands = new SuccessfulCommands(context.task);
    const executor = new V0TaskExecutor({
      persistence: context.persistence,
      github,
      commands,
      projectRoot: context.projectRoot,
      codexEnvironment: { PATH: "/usr/bin", CODEX_API_KEY: "dedicated" },
      gitEnvironment: { PATH: "/usr/bin" },
      now: () => new Date(now),
    });

    await executor.execute(context.task);

    assert.equal(context.task.status, "SUCCESS");
    assert.equal(context.task.branchName, `ade/${context.task.id}`);
    assert.equal(context.task.headSha, "0123456789012345678901234567890123456789");
    assert.equal(context.task.pullRequestNumber, 1);
    assert.match(context.task.pullRequestUrl ?? "", /github\.com/);
    const codex = commands.calls.find(({ executable }) => executable === "codex");
    assert.ok(codex);
    assert.deepEqual(codex.args, [
      "exec",
      "--sandbox",
      "workspace-write",
      "--ephemeral",
      "--json",
      "-",
    ]);
    assert.doesNotMatch(codex.args.join(" "), /Implement the API/);
    assert.match(codex.stdin ?? "", /Implement the API/);
    assert.equal(codex.env?.DATABASE_URL, undefined);
    assert.match(codex.stdin ?? "", /ADE has prepared the normal context profile/);
    assert.deepEqual(
      commands.calls.filter(({ executable }) => executable === "ade").map(({ args }) => args),
      [
        ["--version"],
        ["config", "validate"],
        ["context", "generate"],
        ["context", "pack", "normal"],
        ["setup", "check", "--json"],
        ["review", "--staged", "--json"],
      ],
    );
    assert.match(github.createdPullRequests[0]?.input.body ?? "", /@dokor/);
    assert.match(github.createdPullRequests[0]?.input.body ?? "", /ADE deterministic staged review passed/);
  } finally {
    await context.close();
  }
});

test("blocks the commit, push, and PR when ADE staged review finds an error", async () => {
  const context = await setup();
  try {
    const commands = new SuccessfulCommands(context.task);
    commands.adeReviewExitCode = 1;
    const github = new DeterministicFakeGithubClient();
    await new V0TaskExecutor({
      persistence: context.persistence,
      github,
      commands,
      projectRoot: context.projectRoot,
      now: () => new Date(now),
    }).execute(context.task);

    assert.equal(context.task.status, "FAILED");
    assert.equal(context.task.errorCode, "ADE_DETERMINISTIC_REVIEW_FAILED");
    assert.equal(github.createdPullRequests.length, 0);
    assert.equal(commands.calls.some(({ args }) => args.includes("commit")), false);
    assert.equal(commands.calls.some(({ args }) => args.includes("push")), false);
  } finally {
    await context.close();
  }
});

test("passes the selected GitHub issue through the existing Task pipeline", async () => {
  const context = await setup();
  try {
    context.task.source = { type: "github-issue", issueNumber: 23 };
    context.task.prompt = "Implement GitHub issue #23";
    const commands = new SuccessfulCommands(context.task);
    const github = new DeterministicFakeGithubClient();
    await new V0TaskExecutor({
      persistence: context.persistence,
      github,
      issueReader: {
        listIssues: async () => [],
        getIssue: async () => ({
          number: 23,
          title: "Add the projects page",
          state: "open",
          url: "https://github.com/dokor/alpha/issues/23",
          updatedAt: now,
        }),
      },
      commands,
      projectRoot: context.projectRoot,
      now: () => new Date(now),
    }).execute(context.task);

    const codex = commands.calls.find(({ executable }) => executable === "codex");
    assert.match(codex?.stdin ?? "", /#23: Add the projects page/);
    assert.match(codex?.stdin ?? "", /github\.com\/dokor\/alpha\/issues\/23/);
    assert.match(github.createdPullRequests[0]?.input.body ?? "", /Source issue: #23/);
  } finally {
    await context.close();
  }
});

test("runs ADE initialization before validating the newly created configuration", async () => {
  const context = await setup();
  try {
    context.task.source = { type: "ade-initialize" };
    context.task.prompt = "Initialize ADE for this repository";
    const commands = new SuccessfulCommands(context.task);
    commands.adeConfigMissingUntilCodex = true;
    const github = new DeterministicFakeGithubClient();

    await new V0TaskExecutor({
      persistence: context.persistence,
      github,
      commands,
      projectRoot: context.projectRoot,
      now: () => new Date(now),
    }).execute(context.task);

    assert.equal(context.task.status, "SUCCESS");
    const codexIndex = commands.calls.findIndex(({ executable }) => executable === "codex");
    const firstConfigValidationIndex = commands.calls.findIndex(({ executable, args }) =>
      executable === "ade" && args[0] === "config" && args[1] === "validate",
    );
    assert.ok(codexIndex >= 0);
    assert.ok(firstConfigValidationIndex > codexIndex);
    assert.match(
      commands.calls[codexIndex]?.stdin ?? "",
      /may not have ADE configuration yet/,
    );
    assert.equal(github.createdPullRequests.length, 1);
  } finally {
    await context.close();
  }
});

test("refuses ADE artifacts that are not ignored before Codex starts", async () => {
  const context = await setup();
  try {
    const commands = new SuccessfulCommands(context.task);
    commands.adeArtifactsDirty = true;
    await new V0TaskExecutor({
      persistence: context.persistence,
      github: new DeterministicFakeGithubClient(),
      commands,
      projectRoot: context.projectRoot,
      now: () => new Date(now),
    }).execute(context.task);

    assert.equal(context.task.status, "FAILED");
    assert.equal(context.task.errorCode, "ADE_ARTIFACTS_UNIGNORED");
    assert.equal(commands.calls.some(({ executable }) => executable === "codex"), false);
  } finally {
    await context.close();
  }
});

test("honors cancellation before push and never creates a PR", async () => {
  const context = await setup();
  try {
    const github = new DeterministicFakeGithubClient();
    const commands = new SuccessfulCommands(context.task, true);
    const executor = new V0TaskExecutor({
      persistence: context.persistence,
      github,
      commands,
      projectRoot: context.projectRoot,
      now: () => new Date(now),
    });

    await executor.execute(context.task);

    assert.equal(context.task.status, "CANCELLED");
    assert.equal(github.createdPullRequests.length, 0);
    assert.equal(
      commands.calls.some(({ args }) => args.includes("push")),
      false,
    );
  } finally {
    await context.close();
  }
});

test("refuses a checkout whose origin does not match the registered project", async () => {
  const context = await setup();
  try {
    const commands = new SuccessfulCommands(context.task);
    commands.remote = "https://github.com/attacker/alpha.git";
    await new V0TaskExecutor({
      persistence: context.persistence,
      github: new DeterministicFakeGithubClient(),
      commands,
      projectRoot: context.projectRoot,
      now: () => new Date(now),
    }).execute(context.task);

    assert.equal(context.task.status, "FAILED");
    assert.equal(context.task.errorCode, "REMOTE_MISMATCH");
    assert.equal(
      commands.calls.some(({ executable }) => executable === "codex"),
      false,
    );
  } finally {
    await context.close();
  }
});

class SuccessfulCommands implements CommandRunner {
  public readonly calls: CommandInput[] = [];
  public remote = "git@github.com:dokor/alpha.git";
  public adeReviewExitCode = 0;
  public adeArtifactsDirty = false;
  public adeConfigMissingUntilCodex = false;
  private codexStarted = false;
  private statusCalls = 0;

  public constructor(
    private readonly task: V0TaskRecord,
    private readonly cancelAfterCodex = false,
  ) {}

  public async run(input: CommandInput): Promise<CommandResult> {
    this.calls.push(input);
    if (input.args.includes("get-url")) return result(this.remote);
    if (input.args.includes("rev-parse")) return result("0123456789012345678901234567890123456789\n");
    if (input.args.includes("--porcelain=v1")) {
      const statusCall = this.statusCalls++;
      if (statusCall === 0) return result("");
      if (statusCall === 1) {
        if (this.task.source.type === "ade-initialize") return result(" M ade.config.yaml");
        return result(this.adeArtifactsDirty ? "?? outputs/context/context-pack.md" : "");
      }
      return result(" M src/index.ts");
    }
    if (input.executable === "ade" && input.args[0] === "--version") return result("ade 0.7.0\n");
    if (input.executable === "ade" && input.args[0] === "config" && this.adeConfigMissingUntilCodex && !this.codexStarted) {
      return result("ADE configuration is missing", 1);
    }
    if (input.executable === "ade" && input.args[0] === "review") return result("", this.adeReviewExitCode);
    if (input.executable === "ade" && input.args[0] === "setup") return result('{"version":"ade.project-setup/v1","adeVersion":"0.7.0","readiness":"ready","missingRequiredIds":[]}');
    if (input.executable === "codex") {
      this.codexStarted = true;
      await input.onOutput?.({ stream: "stdout", message: "implementation completed" });
      if (this.cancelAfterCodex) this.task.cancelRequested = true;
    }
    return result("");
  }
}

async function setup() {
  const projectRoot = await mkdtemp(join(tmpdir(), "ade-v0-projects-"));
  const checkout = join(projectRoot, "alpha");
  await mkdir(checkout);
  const project: ProjectRecord = {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "alpha",
    name: "Alpha",
    repositoryOwner: "dokor",
    repositoryName: "alpha",
    repositoryId: "123",
    state: "enabled",
    priority: 50,
    adeAdapter: "local",
    runnerPolicy: {},
    configuration: { v0: { checkout: "alpha", baseBranch: "main" } },
    createdAt: now,
    updatedAt: now,
  };
  const task: V0TaskRecord = {
    id: "22222222-2222-4222-8222-222222222222",
    projectId: project.id,
    source: { type: "prompt", prompt: "Implement the API" },
    prompt: "Implement the API",
    status: "RUNNING",
    cancelRequested: false,
    branchName: null,
    pullRequestNumber: null,
    pullRequestUrl: null,
    errorCode: null,
    errorSummary: null,
    createdAt: now,
    startedAt: now,
    finishedAt: null,
    updatedAt: now,
  };
  const logs: V0TaskLogRecord[] = [];
  const persistence = {
    projects: { getById: async (id: string) => id === project.id ? project : null },
    v0Tasks: {
      getById: async (id: string) => id === task.id ? task : null,
      appendLog: async (input: {
        taskId: string;
        occurredAt: string;
        stream: V0TaskLogRecord["stream"];
        message: string;
      }) => {
        const log = { id: String(logs.length + 1), ...input };
        logs.push(log);
        return log;
      },
      complete: async (input: {
        status: "SUCCESS" | "FAILED" | "CANCELLED";
        finishedAt: string;
        branchName?: string | null;
        pullRequestNumber?: number | null;
        pullRequestUrl?: string | null;
        errorCode?: string | null;
        errorSummary?: string | null;
      }) => {
        Object.assign(task, input, { updatedAt: input.finishedAt });
        return task;
      },
    },
  };
  return {
    projectRoot,
    task,
    persistence,
    close: () => rm(projectRoot, { recursive: true, force: true }),
  };
}

function result(stdout: string, exitCode = 0): CommandResult {
  return { exitCode, signal: null, stdout, stderr: "" };
}
