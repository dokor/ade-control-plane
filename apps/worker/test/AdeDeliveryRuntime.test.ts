import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { withExecutionDiagnostics } from "../src/v0/ExecutionDiagnostics.js";

import type { AgentExecutor, AgentExecutionRequest, AgentExecutionResult } from "../src/AgentExecutor.js";
import { AdeDeliveryError, AdeDeliveryRuntime, type AdeDeliveryPlan, type AdeDeliveryWorkContext } from "../src/AdeDeliveryRuntime.js";
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

test("executes documentation, normal-code and security plans resolved by ADE", async () => {
  const cases = [
    { title: "Update the README documentation", profiles: ["documentation", "tech-lead"] },
    { title: "Add the backend API endpoint", profiles: ["backend", "qa", "tech-lead"] },
    { title: "Fix authentication token permissions", profiles: ["backend", "security", "qa", "tech-lead"] },
  ] as const;
  for (const testCase of cases) {
    const commands = new FakeCommands();
    const agent = new FakeAgent();
    const runtime = new AdeDeliveryRuntime({ commands, expectedVersion: "0.7.0" });
    const prepared = await runtime.prepare({ cwd: "C:/checkout", work: work(testCase.title) });
    const result = await runtime.runPostAgentGates({ cwd: "C:/checkout", work: work(testCase.title), agentExecutor: agent, prepared, plan: deliveryPlan(testCase.profiles) });
    assert.equal(result.provenance.runtimeVersion, "0.7.0");
    assert.equal(result.provenance.setupContractVersion, "ade.project-setup/v1");
    assert.deepEqual(result.provenance.selectedProfiles, testCase.profiles);
    assert.deepEqual(result.provenance.selectedProfileReasons, testCase.profiles.map((profile) => `${profile}: Selected by the ADE delivery plan.`));
    assert.equal(agent.prompts.length, testCase.profiles.length);
    assert.match(agent.prompts[0] ?? "", new RegExp(`ADE invocation for ${testCase.profiles[0]}`));
  }
});

test("blocks missing ADE configuration before agent work", async () => {
  const commands = new FakeCommands();
  commands.configExitCode = 1;
  commands.configStderr = "CONFIG_NOT_FOUND";
  const runtime = new AdeDeliveryRuntime({ commands, expectedVersion: "0.7.0" });
  await assert.rejects(
    runtime.prepare({ cwd: "C:/checkout", work: work("Implement the API") }),
    (error: unknown) => error instanceof AdeDeliveryError && error.code === "ADE_CONFIG_MISSING",
  );
});

test("blocks an ADE setup evaluation that is incomplete", async () => {
  const commands = new FakeCommands();
  commands.setupExitCode = 1;
  commands.setupStdout = '{"version":"ade.project-setup/v1","adeVersion":"0.7.0","readiness":"incomplete","missingRequiredIds":["context.generated"]}';
  const runtime = new AdeDeliveryRuntime({ commands, expectedVersion: "0.7.0" });
  await assert.rejects(
    runtime.prepare({ cwd: "C:/checkout", work: work("Implement the API") }),
    (error: unknown) => error instanceof AdeDeliveryError && error.code === "ADE_SETUP_INCOMPLETE" && error.safeSummary.includes("context.generated"),
  );
});

test("preserves bounded setup reasons, remediation, config errors and capability evidence without secrets", async () => {
  const commands = new FakeCommands();
  commands.setupExitCode = 1;
  commands.setupStdout = JSON.stringify({ version: "ade.project-setup/v1", adeVersion: "0.7.0", readiness: "invalid", missingRequiredIds: ["config.valid"],
    requirements: [{ id: "config.valid", status: "unsatisfied", detail: "Old config schema. credential-value", remediation: "Migrate the config with ADE." }],
    configurationErrors: ["Unknown config key: oldRules. ghp_privateToken"],
    executionCapabilities: [{ id: "delivery-plan", status: "missing", detail: "Configure an implementation profile." }], missingExecutionCapabilityIds: ["delivery-plan"],
    environment: { secret: "must-not-copy" } });
  const evaluation = await withExecutionDiagnostics(["credential-value"], () => new AdeDeliveryRuntime({ commands }).inspectSetup({ cwd: "C:/checkout", work: work("setup") }));
  assert.equal(evaluation.classification, "invalid");
  assert.match(evaluation.diagnostics[0]!.detail, /Old config schema/);
  assert.equal(evaluation.diagnostics[0]!.remediation, "Migrate the config with ADE.");
  assert.deepEqual(evaluation.missingExecutionCapabilityIds, ["delivery-plan"]);
  assert.match(evaluation.configurationErrors[0]!, /oldRules/);
  assert.doesNotMatch(JSON.stringify(evaluation), /credential-value|ghp_privateToken|must-not-copy/);
});

for (const readiness of ["ready", "incomplete"] as const) test(`legacy ADE declaration is diagnostic, not an override of ${readiness} readiness`, async () => {
  const commands = new FakeCommands();
  commands.setupExitCode = readiness === "ready" ? 0 : 1;
  commands.setupStdout = JSON.stringify({ version: "ade.project-setup/v1", adeVersion: "0.7.0", readiness,
    missingRequiredIds: readiness === "ready" ? [] : ["context.generated"] });
  const evaluation = await new AdeDeliveryRuntime({ commands }).inspectSetup({ cwd: fileURLToPath(new URL("./fixtures/legacy-ade/", import.meta.url)), work: work("setup") });
  assert.equal(evaluation.declaredDependency, "^0.3.0");
  assert.equal(evaluation.classification, readiness === "ready" ? "compatible" : "outdated");
  assert.equal(evaluation.readiness, readiness);
});

for (const missing of ["config.ade-config", "context.generated"]) test(`classifies missing setup requirement ${missing}`, async () => {
  const commands = new FakeCommands(); commands.setupExitCode = 1;
  commands.setupStdout = JSON.stringify({ version: "ade.project-setup/v1", adeVersion: "0.7.0", readiness: "incomplete", missingRequiredIds: [missing] });
  const evaluation = await new AdeDeliveryRuntime({ commands }).inspectSetup({ cwd: "C:/checkout", work: work("setup") });
  assert.equal(evaluation.classification, missing === "config.ade-config" ? "absent" : "incomplete");
});

test("does not publish after a deterministic ADE review failure", async () => {
  const commands = new FakeCommands();
  commands.reviewExitCode = 1;
  const runtime = new AdeDeliveryRuntime({ commands, expectedVersion: "0.7.0" });
  const prepared = await runtime.prepare({ cwd: "C:/checkout", work: work("Implement the API") });
  await assert.rejects(
    runtime.runPostAgentGates({ cwd: "C:/checkout", work: work("Implement the API"), agentExecutor: new FakeAgent(), prepared, plan: deliveryPlan(["backend"]) }),
    (error: unknown) => error instanceof AdeDeliveryError && error.code === "ADE_DETERMINISTIC_REVIEW_FAILED",
  );
});

test("retries blocking profile findings with a bounded correction loop", async () => {
  const commands = new FakeCommands();
  const agent = new SequenceAgent([
    passReview(), blockingReview(), passReview(), passReview(), passReview(), passReview(),
  ]);
  const runtime = new AdeDeliveryRuntime({ commands, expectedVersion: "0.7.0" });
  const prepared = await runtime.prepare({ cwd: "C:/checkout", work: work("Fix authentication permissions") });
  const result = await runtime.runPostAgentGates({ cwd: "C:/checkout", work: work("Fix authentication permissions"), agentExecutor: agent, prepared, plan: deliveryPlan(["backend", "security", "qa", "tech-lead"], 2) });
  assert.equal(result.provenance.profileReviewAttempts, 2);
  assert.equal(agent.prompts.filter((prompt) => prompt.includes("ADE correction invocation")).length, 1);
});

test("blocks an incompatible ADE delivery contract with its precise reason", async () => {
  const commands = new FakeCommands();
  commands.deliveryPlanStdout = JSON.stringify({
    version: "ade.delivery-plan/v1", status: "unsupported", plan: null,
    reason: { code: "MISSING_REQUIRED_CAPABILITY", message: "ADE does not provide required capability profile-invocations." },
  });
  const runtime = new AdeDeliveryRuntime({ commands, expectedVersion: "0.7.0" });
  await assert.rejects(
    runtime.resolveDeliveryPlan({ cwd: "C:/checkout", issue: { number: 144, title: "Delivery plan", body: "", labels: [], state: "open", url: "https://github.com/dokor/alpha/issues/144" }, observedGithubLabels: ["backlog-refined", "ready-for-dev"] }),
    (error: unknown) => error instanceof AdeDeliveryError && error.code === "ADE_DELIVERY_PLAN_UNSUPPORTED" && error.safeSummary.includes("MISSING_REQUIRED_CAPABILITY"),
  );
  assert.deepEqual(JSON.parse(commands.deliveryPlanStdin ?? "{}").negotiation.requiredCapabilities, ["implementation-context", "deterministic-validation", "specialist-review", "profile-invocations", "correction-and-rereview", "human-publication-gate"]);
  assert.deepEqual(JSON.parse(commands.deliveryPlanStdin ?? "{}").observedGithubLabels, ["backlog-refined", "ready-for-dev"]);
});

test("applies a resolved human decision through the versioned ADE contract", async () => {
  const commands = new FakeCommands();
  commands.decisionStdout = JSON.stringify({
    protocolVersion: "1",
    operation: "apply-decision",
    value: { decisionRef: "decision-1", state: "applied", summary: "Continuing." },
  });
  const runtime = new AdeDeliveryRuntime({ commands, expectedVersion: "0.7.0" });
  const result = await runtime.applyHumanDecision({
    cwd: "C:/checkout",
    projectRef: "alpha",
    decision: { actorRef: "github:dokor", decisionRef: "decision-1", option: "resume" },
  });
  assert.equal(result.state, "applied");
  assert.deepEqual(JSON.parse(commands.decisionArgs?.at(-1)?.at(-1) ?? "{}"), {
    actorRef: "github:dokor", decisionRef: "decision-1", option: "resume",
  });
});

function deliveryPlan(profiles: readonly string[], maximumCorrectionAttempts = 1): AdeDeliveryPlan {
  return {
    version: "ade.delivery-plan/v1", action: "develop", reason: "ADE has admitted this work.", implementationProfile: "implementation",
    reviews: profiles.map((profile) => ({ profile, selectionReason: "Selected by the ADE delivery plan.", instructions: `ADE invocation for ${profile}` })),
    validationRuleIds: ["lint"], maximumCorrectionAttempts, correctionInstructions: "ADE correction invocation", publicationReady: true,
  };
}

class FakeCommands implements CommandRunner {
  public readonly adeArgs: string[][] = [];
  public configExitCode = 0;
  public configStderr = "";
  public setupExitCode = 0;
  public setupStdout = '{"version":"ade.project-setup/v1","adeVersion":"0.7.0","readiness":"ready","missingRequiredIds":[]}';
  public reviewExitCode = 0;
  public deliveryPlanStdout = "";
  public deliveryPlanStdin: string | undefined;
  public decisionStdout = "";
  public decisionArgs: string[][] = [];

  public async run(input: CommandInput): Promise<CommandResult> {
    if (input.executable === "ade") {
      this.adeArgs.push([...input.args]);
      if (input.args[0] === "--version") return result("ade 0.7.0\n");
      if (input.args[0] === "config") return result("", this.configExitCode, this.configStderr);
      if (input.args[0] === "setup") return result(this.setupStdout, this.setupExitCode);
      if (input.args[0] === "review") return result("{\"status\":\"pass\"}\n", this.reviewExitCode);
      if (input.args[0] === "delivery") {
        this.deliveryPlanStdin = input.stdin;
        return result(this.deliveryPlanStdout);
      }
      if (input.args[0] === "control-plane") {
        this.decisionArgs.push([...input.args]);
        return result(this.decisionStdout);
      }
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
