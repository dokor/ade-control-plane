import assert from "node:assert/strict";
import test from "node:test";

import type { AgentExecutor, AgentExecutionRequest, AgentExecutionResult } from "../src/AgentExecutor.js";
import { AdeDeliveryError, AdeDeliveryRuntime, selectProfiles, type AdeDeliveryWorkContext } from "../src/AdeDeliveryRuntime.js";
import type { ProjectRecord } from "@ade-control-plane/database";
import type { CommandInput, CommandResult, CommandRunner } from "../src/v0/CommandRunner.js";

const NOW = "2026-09-01T10:00:00.000Z";

function project(configuration: ProjectRecord["configuration"] = {}): ProjectRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "alpha",
    name: "Alpha",
    repositoryOwner: "dokor",
    repositoryName: "alpha",
    repositoryId: "123",
    state: "enabled",
    priority: 50,
    adeAdapter: "github-work",
    runnerPolicy: {},
    configuration,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function work(prompt: string, configuration: ProjectRecord["configuration"] = {}): AdeDeliveryWorkContext {
  return { project: project(configuration), source: "prompt", prompt };
}

test("selects different specialist sets for docs, normal code and security work", () => {
  const docs = selectProfiles(work("Update the README documentation"));
  const backend = selectProfiles(work("Add the backend API endpoint"));
  const security = selectProfiles(work("Fix authentication token permissions"));
  assert.deepEqual(docs, ["documentation", "tech-lead"]);
  assert.deepEqual(backend, ["backend", "qa", "tech-lead"]);
  assert.deepEqual(security, ["backend", "security", "qa", "tech-lead"]);
});

test("runs the ADE gates and returns safe provenance", async () => {
  const commands = new FakeCommands();
  const agent = new FakeAgent();
  const runtime = new AdeDeliveryRuntime({ commands, expectedVersion: "0.6.1", maxReviewAttempts: 1 });
  const prepared = await runtime.prepare({ cwd: "C:/checkout", work: work("Update the README documentation") });
  const result = await runtime.runPostAgentGates({ cwd: "C:/checkout", work: work("Update the README documentation"), agentExecutor: agent, prepared });
  assert.equal(result.provenance.runtimeVersion, "0.6.1");
  assert.equal(result.provenance.deterministicReview, "passed");
  assert.deepEqual(result.provenance.selectedProfiles, ["documentation", "tech-lead"]);
  assert.deepEqual(commands.adeArgs, [["--version"], ["config", "validate"], ["context", "pack", "normal"], ["review", "--staged", "--json"]]);
  assert.equal(agent.prompts.length, 2);
  assert.match(agent.prompts[0] ?? "", /documentation specialist reviewer/);
});

test("blocks missing ADE configuration before agent work", async () => {
  const commands = new FakeCommands();
  commands.configExitCode = 1;
  commands.configStderr = "CONFIG_NOT_FOUND";
  const runtime = new AdeDeliveryRuntime({ commands, expectedVersion: "0.6.1" });
  await assert.rejects(
    runtime.prepare({ cwd: "C:/checkout", work: work("Implement the API") }),
    (error: unknown) => error instanceof AdeDeliveryError && error.code === "ADE_CONFIG_MISSING",
  );
});

test("does not publish after a deterministic ADE review failure", async () => {
  const commands = new FakeCommands();
  commands.reviewExitCode = 1;
  const runtime = new AdeDeliveryRuntime({ commands, expectedVersion: "0.6.1" });
  const prepared = await runtime.prepare({ cwd: "C:/checkout", work: work("Implement the API") });
  await assert.rejects(
    runtime.runPostAgentGates({ cwd: "C:/checkout", work: work("Implement the API"), agentExecutor: new FakeAgent(), prepared }),
    (error: unknown) => error instanceof AdeDeliveryError && error.code === "ADE_DETERMINISTIC_REVIEW_FAILED",
  );
});

test("retries blocking profile findings with a bounded correction loop", async () => {
  const commands = new FakeCommands();
  const agent = new SequenceAgent([
    passReview(), blockingReview(), passReview(), passReview(), passReview(), passReview(),
  ]);
  const runtime = new AdeDeliveryRuntime({ commands, expectedVersion: "0.6.1", maxReviewAttempts: 2 });
  const prepared = await runtime.prepare({ cwd: "C:/checkout", work: work("Fix authentication permissions") });
  const result = await runtime.runPostAgentGates({ cwd: "C:/checkout", work: work("Fix authentication permissions"), agentExecutor: agent, prepared });
  assert.equal(result.provenance.profileReviewAttempts, 2);
  assert.equal(agent.prompts.filter((prompt) => prompt.includes("corrections required")).length, 1);
});

class FakeCommands implements CommandRunner {
  public readonly adeArgs: string[][] = [];
  public configExitCode = 0;
  public configStderr = "";
  public reviewExitCode = 0;

  public async run(input: CommandInput): Promise<CommandResult> {
    if (input.executable === "ade") {
      this.adeArgs.push([...input.args]);
      if (input.args[0] === "--version") return result("ade 0.6.1\n");
      if (input.args[0] === "config") return result("", this.configExitCode, this.configStderr);
      if (input.args[0] === "review") return result("{\"status\":\"pass\"}\n", this.reviewExitCode);
    }
    if (input.executable === "git" && input.args.includes("--name-only")) return result("README.md\n");
    return result("");
  }
}

class FakeAgent implements AgentExecutor {
  public readonly provider = "codex" as const;
  public readonly capabilities = ["test"] as const;
  public readonly prompts: string[] = [];

  public async execute(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
    this.prompts.push(request.prompt);
    return { ...result(passReview()), usage: { totalTokens: 1, usageSource: "test" } };
  }
}

class SequenceAgent extends FakeAgent {
  private index = 0;

  public constructor(private readonly outputs: readonly string[]) { super(); }

  public override async execute(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
    this.prompts.push(request.prompt);
    return { ...result(this.outputs[this.index++] ?? passReview()), usage: { totalTokens: 1, usageSource: "test" } };
  }
}

function passReview(): string { return '{"status":"pass","findings":[]}'; }
function blockingReview(): string { return '{"status":"findings","findings":[{"severity":"error","category":"security","summary":"Permission check is missing.","blocking":true,"status":"open"}]}'; }
function result(stdout: string, exitCode = 0, stderr = ""): CommandResult { return { exitCode, signal: null, stdout, stderr }; }
