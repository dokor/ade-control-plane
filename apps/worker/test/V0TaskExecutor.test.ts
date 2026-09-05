import assert from "node:assert/strict";
import { copyFile, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  ProjectRecord,
  V0TaskLogRecord,
  V0TaskRecord,
  V0TaskWorkflow,
} from "@ade-control-plane/database";
import { DeterministicFakeGithubClient } from "@ade-control-plane/github";

import type { CommandInput, CommandResult, CommandRunner } from "../src/v0/CommandRunner.js";
import { V0TaskExecutor } from "../src/v0/V0TaskExecutor.js";
import { ProjectProvisioningError, provisionProjectCheckout } from "../src/v0/ProjectProvisioner.js";
import { CodexAgentExecutor, type AgentExecutionRequest, type AgentExecutionResult, type AgentExecutor } from "../src/AgentExecutor.js";

const now = "2026-08-27T10:00:00.000Z";

for (const outcome of ["success", "dirty", "cancel"] as const) test(`isolated task workspace is used and released on ${outcome}`, async () => {
  const context = await setup();
  const isolated = join(context.projectRoot, "isolated");
  let released = false;
  const successful = new SuccessfulCommands(context.task, outcome === "cancel");
  try {
    await cp(join(context.projectRoot, "alpha"), isolated, { recursive: true });
    const commands: CommandRunner = { run: (input) => {
      assert.equal(input.cwd, isolated);
      if (outcome === "dirty" && input.args.includes("--porcelain=v1")) return Promise.resolve(result(" M tracked\n?? untracked\n"));
      return successful.run(input);
    } };
    await new V0TaskExecutor({ persistence: context.persistence, github: new DeterministicFakeGithubClient(), commands, projectRoot: context.projectRoot,
      workspaces: { prepare: async (project, id, kind) => {
        assert.equal(project.id, context.task.projectId); assert.equal(id, context.task.id); assert.equal(kind, "task");
        return { root: isolated, baseBranch: "main", release: async () => { released = true; } };
      } }, logDiagnostic: () => {},
    }).execute(context.task);
    assert.equal(context.task.status, outcome === "success" ? "SUCCESS" : outcome === "cancel" ? "CANCELLED" : "FAILED");
    if (outcome === "dirty") {
      assert.equal(context.task.errorCode, "CHECKOUT_DIRTY");
      assert.match(context.task.errorSummary!, /isolated=true; tracked=1; untracked=1/);
    }
    assert.equal(released, true);
  } finally { await context.close(); }
});

for (const code of ["GIT_CLONE_FAILED", "CHECKOUT_CONFIGURATION_INVALID", "CHECKOUT_REMOTE_MISMATCH"] as const) {
  test(`preserves provisioning code ${code} with correlated diagnostics`, async () => {
    const context = await setup({ checkoutExists: false });
    const diagnostics: unknown[] = [];
    try {
      await new V0TaskExecutor({ persistence: context.persistence, github: new DeterministicFakeGithubClient(),
        commands: new SuccessfulCommands(context.task), projectRoot: context.projectRoot,
        provisionCheckout: async () => { throw new ProjectProvisioningError(code, "Checkout preparation failed."); },
        logDiagnostic: (entry) => diagnostics.push(entry),
      }).execute(context.task);
      assert.equal(context.task.errorCode, code);
      assert.equal(context.task.branchName, null);
      assert.equal((diagnostics[0] as { taskId: string }).taskId, context.task.id);
      assert.match(JSON.stringify(diagnostics), /Provision checkout/);
      assert.ok(context.logs.some((log) => log.message.includes('"event":"task.execution.failed"')));
    } finally { await context.close(); }
  });
}

test("captures preflight stderr and its specific cause from the real provisioner", async () => {
  const context = await setup({ checkoutExists: false });
  const diagnostics: unknown[] = [];
  try {
    const commands = { run: async () => ({ exitCode: 128, signal: null, stdout: "", stderr: "fatal: repository not found; token=super-private" }) };
    await new V0TaskExecutor({ persistence: context.persistence, github: new DeterministicFakeGithubClient(), commands,
      projectRoot: context.projectRoot, logDiagnostic: (entry) => diagnostics.push(entry),
      provisionCheckout: (project, signal) => provisionProjectCheckout({ project, commands, projectRoot: context.projectRoot,
        gitEnvironment: {}, ...(signal ? { signal } : {}), persistence: { auditEvents: { append: async () => ({}) as never } } }),
    }).execute(context.task);
    assert.equal(context.task.errorCode, "REPOSITORY_NOT_FOUND");
    assert.match(JSON.stringify(diagnostics), /git ls-remote/);
    assert.match(JSON.stringify(diagnostics), /repository not found/);
    assert.match(JSON.stringify(diagnostics), /"exitCode":128/);
    assert.doesNotMatch(JSON.stringify([diagnostics, context.logs]), /super-private/);
  } finally { await context.close(); }
});

test("keeps correlated audit/server evidence when the raw log budget is exhausted", async () => {
  const context = await setup({ checkoutExists: false });
  const audits: unknown[] = [], diagnostics: unknown[] = [];
  try {
    await new V0TaskExecutor({ persistence: { ...context.persistence,
      v0Tasks: { ...context.persistence.v0Tasks, appendLog: async () => null },
      auditEvents: { append: async (input) => { audits.push(input); return {} as never; } } },
      github: new DeterministicFakeGithubClient(), commands: new SuccessfulCommands(context.task), projectRoot: context.projectRoot,
      provisionCheckout: async () => { throw new ProjectProvisioningError("GIT_CLONE_FAILED", "Clone failed."); },
      logDiagnostic: (entry) => diagnostics.push(entry),
    }).execute(context.task);
    assert.equal(context.task.errorCode, "GIT_CLONE_FAILED");
    assert.equal(diagnostics.length, 1);
    assert.match(JSON.stringify(audits), new RegExp(`"correlationId":"${context.task.id}"`));
    assert.match(JSON.stringify(audits), /GIT_CLONE_FAILED/);
  } finally { await context.close(); }
});

for (const failure of ["unknown", "spawn", "exit"] as const) test(`persists ${failure} diagnostics without leaking secrets`, async () => {
  const context = await setup();
  const diagnostics: unknown[] = [];
  try {
    const successful = new SuccessfulCommands(context.task);
    const commands: CommandRunner = { run: async (input) => {
      if (input.executable !== "codex") return successful.run(input);
      if (failure === "exit") {
        const stderr = "Authentication failed: Bearer abc-supersecret\nCUSTOM_API_KEY=opaque-custom-secret";
        await input.onOutput?.({ stream: "stderr", message: stderr });
        return { exitCode: 17, signal: null, stdout: "", stderr };
      }
      const error = new Error("Cannot start worker: opaque-custom-secret token=another-secret");
      if (failure === "spawn") Object.assign(error, { code: "ENOENT" });
      throw error;
    } };
    await new V0TaskExecutor({ persistence: context.persistence, commands, github: new DeterministicFakeGithubClient(),
      projectRoot: context.projectRoot, codexEnvironment: { CUSTOM_API_KEY: "opaque-custom-secret" },
      agentExecutor: new CodexAgentExecutor({ commands, executable: "codex", environment: { CUSTOM_API_KEY: "opaque-custom-secret" } }),
      logDiagnostic: (entry) => diagnostics.push(entry),
    }).execute(context.task);
    assert.equal(context.task.errorCode, failure === "exit" ? "AGENT_EXECUTION_FAILED" : failure === "spawn" ? "ENOENT" : "EXECUTION_FAILED");
    assert.match(JSON.stringify(diagnostics), /Run Codex/);
    assert.match(JSON.stringify(diagnostics), /codex exec/);
    assert.doesNotMatch(JSON.stringify([context.task.errorSummary, context.logs, diagnostics]), /abc-supersecret|opaque-custom-secret|another-secret/);
    if (failure === "spawn") assert.match(JSON.stringify(diagnostics), /ENOENT/);
    if (failure === "unknown") {
      assert.equal(context.task.errorSummary, "Task execution failed.");
      assert.match(JSON.stringify(diagnostics), /Cannot start worker/);
      assert.match(JSON.stringify(diagnostics), /"stack":"Error:/);
    }
    if (failure === "exit") assert.match(JSON.stringify(diagnostics), /"exitCode":17/);
  } finally { await context.close(); }
});

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
        ["delivery", "plan", "--json"],
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
    assert.ok(context.logs.some(({ message }) => message === "git fetch passed."));
    assert.ok(context.logs.some(({ message }) => message === "git commit passed."));
    assert.ok(context.logs.some(({ message }) => message === "codex execution passed."));
  } finally {
    await context.close();
  }
});

test("provisions a missing checkout before executing a manual task", async () => {
  const context = await setup({ checkoutExists: false });
  try {
    let provisionedProject: string | undefined;
    const executor = new V0TaskExecutor({
      persistence: context.persistence,
      github: new DeterministicFakeGithubClient(),
      commands: new SuccessfulCommands(context.task),
      projectRoot: context.projectRoot,
      provisionCheckout: async (project) => {
        provisionedProject = project.id;
        await mkdir(join(context.projectRoot, "alpha"));
      },
      now: () => new Date(now),
    });

    await executor.execute(context.task);

    assert.equal(provisionedProject, "11111111-1111-4111-8111-111111111111");
    assert.equal(context.task.status, "SUCCESS");
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
    assert.deepEqual(context.readinessProofs[0], {
      projectId: "11111111-1111-4111-8111-111111111111",
      status: "incompatible",
      configVersion: "ade.project-setup/v1",
      runtimeVersion: "0.7.0",
      resolvedProfiles: [],
      resolvedRules: [],
      contextStatus: "unknown",
      missingRequiredCapabilityIds: ["config.file"],
      runnerCheckoutRef: "0123456789012345678901234567890123456789",
      observedAt: now,
    });
  } finally {
    await context.close();
  }
});

test("records a merged setup checkout only after its read-only ADE check succeeds", async () => {
  const context = await setup();
  try {
    context.task.source = { type: "ade-initialize" };
    context.task.prompt = "Verify ADE setup after merge";
    const commands = new SuccessfulCommands(context.task);
    const github = new DeterministicFakeGithubClient();

    await new V0TaskExecutor({
      persistence: context.persistence,
      github,
      commands,
      projectRoot: context.projectRoot,
      now: () => new Date(now),
    }).execute(context.task);

    assert.equal(context.task.status, "SUCCESS");
    assert.equal(commands.calls.some(({ executable }) => executable === "codex"), false);
    assert.equal(github.createdPullRequests.length, 0);
    assert.equal((context.readinessProofs[0] as { status?: string } | undefined)?.status, "compatible");
  } finally {
    await context.close();
  }
});

for (const remainsIncomplete of [false, true]) test(`initialization without diff reinspects setup: ${remainsIncomplete ? "incomplete" : "ready"}`, async () => {
  const context = await setup();
  try {
    context.task.source = { type: "ade-initialize" };
    const commands = new SuccessfulCommands(context.task);
    commands.adeConfigMissingUntilCodex = true;
    commands.noChanges = true;
    if (remainsIncomplete) commands.setupAfterCodex = JSON.stringify({ version: "ade.project-setup/v1", adeVersion: "0.7.0", readiness: "incomplete",
      missingRequiredIds: ["context.generated"], requirements: [{ id: "context.generated", status: "unsatisfied", detail: "Project context is stale.", remediation: "Run ade context generate." }] });
    const github = new DeterministicFakeGithubClient();
    await new V0TaskExecutor({ persistence: context.persistence, github, commands, projectRoot: context.projectRoot }).execute(context.task);
    assert.equal(context.task.status, remainsIncomplete ? "FAILED" : "SUCCESS");
    assert.equal(context.task.errorCode, remainsIncomplete ? "ADE_SETUP_STILL_INCOMPLETE" : null);
    assert.equal(commands.calls.filter((call) => call.executable === "ade" && call.args[0] === "setup").length, 2);
    assert.match(commands.calls.find((call) => call.executable === "codex")?.stdin ?? "", /Missing required: config.file/);
    assert.equal(github.createdPullRequests.length, 0);
    assert.equal(commands.calls.some((call) => call.args.includes("commit") || call.args.includes("push")), false);
    assert.equal((context.readinessProofs.at(-1) as { status: string }).status, remainsIncomplete ? "incompatible" : "compatible");
    const logs = context.logs.map((log) => log.message).join("\n");
    assert.match(logs, /ade.setup.inspected/);
    if (remainsIncomplete) { assert.match(logs, /Project context is stale/); assert.match(context.task.errorSummary!, /context.generated/); }
  } finally { await context.close(); }
});

test("persists user-facing workflow transitions separately from terminal task status", async () => {
  const context = await setup();
  const workflows: V0TaskWorkflow[] = [];
  context.persistence.v0Tasks.updateWorkflow = async (input: { taskId: string; workflow: V0TaskWorkflow }) => {
    assert.equal(input.taskId, context.task.id);
    workflows.push(input.workflow);
    context.task.workflow = input.workflow;
    return context.task;
  };
  try {
    await new V0TaskExecutor({
      persistence: context.persistence,
      github: new DeterministicFakeGithubClient(),
      commands: new SuccessfulCommands(context.task),
      projectRoot: context.projectRoot,
      now: () => new Date(now),
    }).execute(context.task);

    assert.equal(context.task.status, "SUCCESS");
    assert.deepEqual(workflows.map(({ state }) => state), [
      "preparing", "preparing", "ready-for-dev", "developing", "reviewing", "preparing-pr",
    ]);
    assert.equal(context.task.workflow?.state, "completed");
    assert.equal(context.task.workflow?.recoverable, false);
    assert.ok(context.logs.some(({ message }) => message.includes('"event":"task.workflow"')));
  } finally {
    await context.close();
  }
});

test("enriches an under-specified GitHub issue and resumes the same task", async () => {
  const context = await setup();
  context.task.source = { type: "github-issue", issueNumber: 23 };
  context.task.prompt = "Implement GitHub issue #23";
  const github = new DeterministicFakeGithubClient();
  github.issues.set(23, {
    number: 23,
    title: "Add the projects page",
    body: "Existing product context that must be preserved.",
    labels: [],
    state: "open",
    url: "https://github.com/dokor/alpha/issues/23",
    updatedAt: now,
  });
  const commands = new EnrichmentCommands(new SuccessfulCommands(context.task));
  const prompts: string[] = [];
  const agent = {
    provider: "codex" as const,
    capabilities: ["test"] as const,
    execute: async (request: AgentExecutionRequest): Promise<AgentExecutionResult> => {
      prompts.push(request.prompt);
      const enrichment = request.prompt.includes("Return only the proposed GitHub issue body");
      return {
        exitCode: 0,
        signal: null,
        stdout: enrichment ? JSON.stringify({ result: "## Objective\nDeliver the projects page.\n\n## Acceptance Criteria\n- The page loads.\n- Projects are listed.\n- Errors are visible." }) : '{"status":"pass","findings":[]}',
        stderr: "",
        usage: { totalTokens: 1, usageSource: "test" },
      };
    },
  } satisfies AgentExecutor;

  try {
    await new V0TaskExecutor({
      persistence: context.persistence,
      github,
      issueReader: { listIssues: async () => [], getIssue: async () => ({ number: 23, title: "Add the projects page", state: "open", url: "https://github.com/dokor/alpha/issues/23", updatedAt: now }) },
      commands,
      agentExecutor: agent,
      projectRoot: context.projectRoot,
      now: () => new Date(now),
    }).execute(context.task);

    assert.equal(context.task.status, "SUCCESS");
    assert.equal(commands.deliveryPlanCalls, 2);
    assert.equal(commands.lifecyclePlanCalls, 2);
    assert.match(github.issues.get(23)?.body ?? "", /Existing product context/);
    assert.match(github.issues.get(23)?.body ?? "", /## Acceptance Criteria/);
    assert.match(prompts[0] ?? "", /Existing product context/);
    assert.ok(context.logs.some(({ message }) => /Issue enrichment attempt 1\/2 started/.test(message)));
    assert.ok(context.logs.some(({ message }) => message.includes('"state":"enriching-issue"')));
  } finally {
    await context.close();
  }
});

test("partial setup sends exact sanitized remediation to Codex and retains structured logs", async () => {
  const context = await setup();
  try {
    context.task.source = { type: "ade-initialize" };
    const commands = new SuccessfulCommands(context.task); commands.noChanges = true;
    commands.setupBeforeCodex = JSON.stringify({ version: "ade.project-setup/v1", adeVersion: "0.7.0", readiness: "incomplete", missingRequiredIds: ["context.generated"],
      requirements: [{ id: "context.generated", status: "unsatisfied", criticality: "required", detail: "Context is stale. ghp_neverExpose", remediation: "Run ade context generate." }] });
    await new V0TaskExecutor({ persistence: context.persistence, github: new DeterministicFakeGithubClient(), commands, projectRoot: context.projectRoot }).execute(context.task);
    const prompt = commands.calls.find((call) => call.executable === "codex")!.stdin!;
    assert.match(prompt, /Context is stale/); assert.match(prompt, /Run ade context generate/);
    assert.match(prompt, /Preserve existing configuration/); assert.doesNotMatch(prompt, /ghp_neverExpose/);
    const events = context.logs.filter((log) => log.message.startsWith('{"event":"ade.setup.')).map((log) => JSON.parse(log.message));
    assert.ok(events.some((event) => event.event === "ade.setup.requirement" && event.remediation === "Run ade context generate."));
    assert.doesNotMatch(JSON.stringify(events), /ghp_neverExpose/);
    assert.equal(context.task.status, "SUCCESS");
  } finally { await context.close(); }
});

test("legacy partial initialization becomes a targeted upgrade with a reviewed PR", async () => {
  const context = await setup();
  try {
    await copyFile(new URL("./fixtures/legacy-ade/package.json", import.meta.url), join(context.projectRoot, "alpha", "package.json"));
    context.task.source = { type: "ade-initialize" };
    const commands = new SuccessfulCommands(context.task);
    commands.setupBeforeCodex = JSON.stringify({ version: "ade.project-setup/v1", adeVersion: "0.7.0", readiness: "invalid", missingRequiredIds: ["config.valid"], configurationErrors: ["Legacy rules configuration requires migration."] });
    const github = new DeterministicFakeGithubClient();
    await new V0TaskExecutor({ persistence: context.persistence, github, commands, projectRoot: context.projectRoot }).execute(context.task);
    const prompt = commands.calls.find((call) => call.executable === "codex")!.stdin!;
    assert.match(prompt, /outdated/); assert.match(prompt, /\^0\.3\.0/); assert.match(prompt, /worker runtime 0\.7\.0/);
    assert.match(prompt, /Legacy rules configuration requires migration/);
    assert.equal(context.task.status, "SUCCESS");
    assert.equal(github.createdPullRequests.length, 1);
    // Unmerged generated configuration must not mark the default branch ready.
    assert.equal(context.readinessProofs.some((proof) => (proof as { status: string }).status === "compatible"), false);
  } finally { await context.close(); }
});

for (const interruption of ["cancel", "unreviewed-commit"] as const) test(`no-diff initialization does not record readiness after ${interruption}`, async () => {
  const context = await setup();
  try {
    context.task.source = { type: "ade-initialize" };
    const commands = new SuccessfulCommands(context.task); commands.noChanges = true; commands.adeConfigMissingUntilCodex = true;
    const guarded: CommandRunner = { run: async (input) => {
      const output = await commands.run(input);
      if (commands.calls.some((call) => call.executable === "codex")) {
        if (interruption === "cancel" && input.args[0] === "setup") context.task.cancelRequested = true;
        if (interruption === "unreviewed-commit" && input.args.includes("rev-parse") && input.args.includes("HEAD")) return result("a".repeat(40));
      }
      return output;
    } };
    const github = new DeterministicFakeGithubClient();
    await new V0TaskExecutor({ persistence: context.persistence, github, commands: guarded, projectRoot: context.projectRoot }).execute(context.task);
    assert.equal(context.task.status, interruption === "cancel" ? "CANCELLED" : "FAILED");
    assert.equal(context.task.errorCode, interruption === "cancel" ? null : "ADE_SETUP_HEAD_CHANGED");
    assert.equal(context.readinessProofs.some((proof) => (proof as { status: string }).status === "compatible"), false);
    assert.equal(github.createdPullRequests.length, 0);
  } finally { await context.close(); }
});

test("ordinary development without diff still fails with NO_CHANGES", async () => {
  const context = await setup();
  try {
    const commands = new SuccessfulCommands(context.task); commands.noChanges = true;
    await new V0TaskExecutor({ persistence: context.persistence, github: new DeterministicFakeGithubClient(), commands, projectRoot: context.projectRoot }).execute(context.task);
    assert.equal(context.task.errorCode, "NO_CHANGES");
  } finally { await context.close(); }
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
  public noChanges = false;
  public setupAfterCodex: string | null = null;
  public setupBeforeCodex: string | null = null;
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
      if (this.noChanges) return result("");
      const statusCall = this.statusCalls++;
      if (statusCall === 0) return result("");
      if (statusCall === 1 || (statusCall === 2 && !this.codexStarted)) {
        if (this.task.source.type === "ade-initialize") return result(" M ade.config.yaml");
        return result(this.adeArtifactsDirty ? "?? outputs/context/context-pack.md" : "");
      }
      return result(" M src/index.ts");
    }
    if (input.executable === "ade" && input.args[0] === "--version") return result("ade 0.7.0\n");
    if (input.executable === "ade" && input.args[0] === "delivery") return result(deliveryPlanResponse());
    if (input.executable === "ade" && input.args[0] === "config" && this.adeConfigMissingUntilCodex && !this.codexStarted) {
      return result("ADE configuration is missing", 1);
    }
    if (input.executable === "ade" && input.args[0] === "review") return result("", this.adeReviewExitCode);
    if (input.executable === "ade" && input.args[0] === "setup" && this.codexStarted && this.setupAfterCodex) return result(this.setupAfterCodex, 1);
    if (input.executable === "ade" && input.args[0] === "setup" && !this.codexStarted && this.setupBeforeCodex) return result(this.setupBeforeCodex, 1);
    if (input.executable === "ade" && input.args[0] === "setup") return this.adeConfigMissingUntilCodex && !this.codexStarted
      ? result('{"version":"ade.project-setup/v1","adeVersion":"0.7.0","readiness":"incomplete","missingRequiredIds":["config.file"]}', 1)
      : result('{"version":"ade.project-setup/v1","adeVersion":"0.7.0","readiness":"ready","missingRequiredIds":[]}');
    if (input.executable === "codex") {
      this.codexStarted = true;
      await input.onOutput?.({ stream: "stdout", message: "implementation completed" });
      if (this.cancelAfterCodex) this.task.cancelRequested = true;
    }
    return result("");
  }
}

class EnrichmentCommands implements CommandRunner {
  public deliveryPlanCalls = 0;
  public lifecyclePlanCalls = 0;

  public constructor(private readonly base: SuccessfulCommands) {}

  public async run(input: CommandInput): Promise<CommandResult> {
    if (input.executable === "ade" && input.args[0] === "delivery") {
      this.deliveryPlanCalls += 1;
      return result(deliveryPlanResponse(this.deliveryPlanCalls === 1 ? "enrich" : "develop"));
    }
    if (input.executable === "ade" && input.args[0] === "issue") {
      this.lifecyclePlanCalls += 1;
      return result(JSON.stringify({ action: this.lifecyclePlanCalls === 1 ? "enrich" : "develop", reason: this.lifecyclePlanCalls === 1 ? "The issue needs an objective and acceptance criteria." : "The issue is ready for development.", ...(this.lifecyclePlanCalls === 1 ? { enrichmentPrompt: "Add the missing objective and at least three acceptance criteria." } : {}) }));
    }
    return this.base.run(input);
  }
}

async function setup(options: { checkoutExists?: boolean } = {}) {
  const projectRoot = await mkdtemp(join(tmpdir(), "ade-v0-projects-"));
  const checkout = join(projectRoot, "alpha");
  if (options.checkoutExists !== false) await mkdir(checkout);
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
  const readinessProofs: unknown[] = [];
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
        workflow?: V0TaskWorkflow | null;
      }) => {
        Object.assign(task, input, { updatedAt: input.finishedAt });
        return task;
      },
      updateWorkflow: async (input: { taskId: string; workflow: V0TaskWorkflow }) => {
        assert.equal(input.taskId, task.id);
        task.workflow = input.workflow;
        return task;
      },
    },
    githubWork: {
      recordAdeReadiness: async (input: unknown) => {
        readinessProofs.push(input);
        return null;
      },
    },
  };
  return {
    projectRoot,
    task,
    logs,
    readinessProofs,
    persistence,
    close: () => rm(projectRoot, { recursive: true, force: true }),
  };
}

function result(stdout: string, exitCode = 0): CommandResult {
  return { exitCode, signal: null, stdout, stderr: "" };
}

function deliveryPlanResponse(action: "enrich" | "develop" = "develop"): string {
  return JSON.stringify({
    version: "ade.delivery-plan/v1", status: "supported", plan: {
      lifecycle: { action, reason: action === "develop" ? "Ready for development." : "Issue needs refinement." },
      implementation: { profile: "implementation" }, validations: [], reviews: [
        { profile: "backend", reason: "Configured by ADE.", invocation: { version: "ade.profile-invocation/v1", kind: "specialist-review", instructions: "Run the ADE backend review." } },
      ],
      correction: { maximumAttempts: 1, invocation: { version: "ade.profile-invocation/v1", kind: "correction", instructions: "Apply ADE review corrections." } },
      publication: { ready: true },
    },
  });
}
