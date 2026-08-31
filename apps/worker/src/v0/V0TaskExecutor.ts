import type {
  ProjectRepository,
  ProjectRecord,
  V0TaskRepository,
  V0TaskRecord,
} from "@ade-control-plane/database";
import type { GithubIssueReader, GithubPullRequestClient, GithubRepositoryRef, GithubIssueSummary } from "@ade-control-plane/github";

import type { CommandOutput, CommandResult, CommandRunner } from "./CommandRunner.js";
import { matchesGithubRemote, resolveProjectCheckout } from "./ProjectCheckout.js";

interface V0Persistence {
  projects: Pick<ProjectRepository, "getById">;
  v0Tasks: Pick<V0TaskRepository, "getById" | "complete" | "appendLog">;
}

export interface V0TaskExecutorOptions {
  persistence: V0Persistence;
  github: GithubPullRequestClient;
  issueReader?: GithubIssueReader;
  commands: CommandRunner;
  projectRoot: string;
  codexExecutable?: string;
  adeExecutable?: string;
  adeProfile?: AdeProfile;
  adeRuntimeVersion?: string;
  gitEnvironment?: Readonly<Record<string, string>>;
  codexEnvironment?: Readonly<Record<string, string>>;
  timeoutMs?: number;
  cancelPollMs?: number;
  now?(): Date;
}

export type AdeProfile = "chill" | "normal" | "expert";

type AbortReason = "cancel" | "timeout" | "shutdown" | null;

export class V0TaskExecutor {
  private readonly codexExecutable: string;
  private readonly adeExecutable: string;
  private readonly adeProfile: AdeProfile;
  private readonly adeRuntimeVersion: string;
  private readonly timeoutMs: number;
  private readonly cancelPollMs: number;
  private readonly now: () => Date;

  public constructor(private readonly options: V0TaskExecutorOptions) {
    this.codexExecutable = options.codexExecutable ?? "codex";
    this.adeExecutable = options.adeExecutable ?? "ade";
    this.adeProfile = options.adeProfile ?? "normal";
    this.adeRuntimeVersion = options.adeRuntimeVersion ?? "unknown";
    this.timeoutMs = options.timeoutMs ?? 60 * 60 * 1_000;
    this.cancelPollMs = options.cancelPollMs ?? 1_000;
    this.now = options.now ?? (() => new Date());
  }

  private get gitEnvironment(): Readonly<Record<string, string>> {
    return this.options.gitEnvironment ?? {};
  }

  private get codexEnvironment(): Readonly<Record<string, string>> {
    return this.options.codexEnvironment ?? {};
  }

  public async execute(task: V0TaskRecord, shutdownSignal?: AbortSignal): Promise<void> {
    if (task.status !== "RUNNING") {
      throw new Error("V0 executor accepts RUNNING tasks only.");
    }

    const controller = new AbortController();
    let abortReason: AbortReason = null;
    let branchName: string | null = null;
    let checkingCancellation = false;
    const abort = (reason: Exclude<AbortReason, null>): void => {
      if (controller.signal.aborted) return;
      abortReason = reason;
      controller.abort();
    };
    const shutdown = (): void => abort("shutdown");
    shutdownSignal?.addEventListener("abort", shutdown, { once: true });
    const timeout = setTimeout(() => abort("timeout"), this.timeoutMs);
    timeout.unref();
    const cancellation = setInterval(async () => {
      if (checkingCancellation || controller.signal.aborted) return;
      checkingCancellation = true;
      try {
        if ((await this.options.persistence.v0Tasks.getById(task.id))?.cancelRequested) {
          abort("cancel");
        }
      } catch {
        abort("shutdown");
      } finally {
        checkingCancellation = false;
      }
    }, this.cancelPollMs);
    cancellation.unref();

    try {
      const project = await this.requireProject(task.projectId);
      const checkout = await resolveProjectCheckout(this.options.projectRoot, project);
      const issue = await this.resolveIssue(task, project);
      branchName = `ade/${task.id}`;
      await this.log(task.id, "Preparing allow-listed checkout.");
      await this.assertNotCancelled(task.id);

      const remote = await this.git(checkout.root, ["remote", "get-url", "origin"]);
      if (!matchesGithubRemote(remote.stdout, project.repositoryOwner, project.repositoryName)) {
        throw new V0ExecutionError("REMOTE_MISMATCH", "Checkout origin does not match the registered GitHub repository.");
      }
      const initialStatus = await this.git(checkout.root, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ]);
      if (initialStatus.stdout.trim()) {
        throw new V0ExecutionError("CHECKOUT_DIRTY", "Checkout contains changes from another operation.");
      }

      await this.mustRun(task.id, "git fetch", {
        executable: "git",
        args: ["fetch", "--prune", "origin", checkout.baseBranch],
        cwd: checkout.root,
        env: this.gitEnvironment,
        signal: controller.signal,
      });
      await this.mustRun(task.id, "git branch preparation", {
        executable: "git",
        args: ["switch", "--force-create", branchName, `origin/${checkout.baseBranch}`],
        cwd: checkout.root,
        env: this.gitEnvironment,
        signal: controller.signal,
      });
      await this.assertNotCancelled(task.id);

      await this.prepareAdeContext(task.id, checkout.root, controller.signal);
      await this.assertCheckoutStillClean(checkout.root);

      await this.log(task.id, `ADE runtime ${this.adeRuntimeVersion}; delivery source ${task.source.type}.`);
      if (issue) await this.log(task.id, `GitHub issue #${issue.number}: ${issue.title}`);
      await this.log(task.id, "Delivery gate: ready-for-dev; starting Codex in workspace-write sandbox.");
      await this.mustRun(task.id, "Codex", {
        executable: this.codexExecutable,
        args: ["exec", "--sandbox", "workspace-write", "--ephemeral", "--json", "-"],
        cwd: checkout.root,
        stdin: buildCodexPrompt(task.prompt, this.adeProfile, issue),
        env: this.codexEnvironment,
        signal: controller.signal,
        onOutput: (output) => this.logCommandOutput(task.id, output),
      });
      await this.assertNotCancelled(task.id);

      const finalStatus = await this.git(checkout.root, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ]);
      if (!finalStatus.stdout.trim()) {
        throw new V0ExecutionError("NO_CHANGES", "Codex completed without producing repository changes.");
      }

      await this.mustRun(task.id, "git add", {
        executable: "git",
        args: ["add", "--all"],
        cwd: checkout.root,
        env: this.gitEnvironment,
        signal: controller.signal,
      });
      await this.mustRun(task.id, "ADE staged review", {
        executable: this.adeExecutable,
        args: ["review", "--staged", "--json"],
        cwd: checkout.root,
        env: this.gitEnvironment,
        signal: controller.signal,
        onOutput: (output) => this.logCommandOutput(task.id, output),
      });
      await this.assertNotCancelled(task.id);
      await this.mustRun(task.id, "git commit", {
        executable: "git",
        args: [
          "-c",
          "user.name=ADE Control Plane",
          "-c",
          "user.email=ade-control-plane@localhost",
          "-c",
          "core.hooksPath=/dev/null",
          "commit",
          "-m",
          `feat: complete task ${task.id}`,
        ],
        cwd: checkout.root,
        env: this.gitEnvironment,
        signal: controller.signal,
      });
      await this.assertNotCancelled(task.id);
      await this.mustRun(task.id, "git push", {
        executable: "git",
        args: ["push", "--set-upstream", "origin", branchName],
        cwd: checkout.root,
        env: this.gitEnvironment,
        signal: controller.signal,
      });
      await this.assertNotCancelled(task.id);

      await this.log(task.id, "Creating GitHub pull request.");
      const pullRequest = await this.options.github.createPullRequest(
        {
          id: project.repositoryId ?? `${project.repositoryOwner}/${project.repositoryName}`,
          owner: project.repositoryOwner,
          name: project.repositoryName,
        },
        {
          title: `ADE task ${task.id.slice(0, 8)}`,
          body: buildPullRequestBody(task, this.adeProfile, issue),
          head: branchName,
          base: checkout.baseBranch,
        },
      );
      await this.log(task.id, "Pull request created; recording terminal status.");
      await this.options.persistence.v0Tasks.complete({
        taskId: task.id,
        status: "SUCCESS",
        finishedAt: this.now().toISOString(),
        branchName,
        pullRequestNumber: pullRequest.number,
        pullRequestUrl: pullRequest.url,
      });
    } catch (error) {
      const latest = await this.options.persistence.v0Tasks.getById(task.id);
      const cancelled = abortReason === "cancel" || latest?.cancelRequested === true;
      const failure = classifyFailure(error, abortReason);
      await this.options.persistence.v0Tasks.complete({
        taskId: task.id,
        status: cancelled ? "CANCELLED" : "FAILED",
        finishedAt: this.now().toISOString(),
        branchName,
        errorCode: cancelled ? null : failure.code,
        errorSummary: cancelled ? null : failure.summary,
      });
      await this.log(
        task.id,
        cancelled ? "Task cancelled." : `Task failed: ${failure.summary}`,
      ).catch(() => undefined);
    } finally {
      clearTimeout(timeout);
      clearInterval(cancellation);
      shutdownSignal?.removeEventListener("abort", shutdown);
    }
  }

  private async requireProject(projectId: string): Promise<ProjectRecord> {
    const project = await this.options.persistence.projects.getById(projectId);
    if (!project) throw new V0ExecutionError("PROJECT_NOT_FOUND", "Registered project was not found.");
    return project;
  }

  private async resolveIssue(task: V0TaskRecord, project: ProjectRecord): Promise<GithubIssueSummary | null> {
    if (task.source.type !== "github-issue") return null;
    const repository: GithubRepositoryRef = {
      id: project.repositoryId ?? `${project.repositoryOwner}/${project.repositoryName}`,
      owner: project.repositoryOwner,
      name: project.repositoryName,
    };
    const issue = await this.options.issueReader?.getIssue(repository, task.source.issueNumber);
    if (this.options.issueReader && !issue) {
      throw new V0ExecutionError("GITHUB_ISSUE_NOT_FOUND", "The selected GitHub issue is no longer available.");
    }
    return issue ?? {
      number: task.source.issueNumber,
      title: task.prompt,
      state: "open",
      url: `https://github.com/${project.repositoryOwner}/${project.repositoryName}/issues/${task.source.issueNumber}`,
      updatedAt: this.now().toISOString(),
    };
  }

  private async assertNotCancelled(taskId: string): Promise<void> {
    if ((await this.options.persistence.v0Tasks.getById(taskId))?.cancelRequested) {
      throw new V0CancelledError();
    }
  }

  private async prepareAdeContext(
    taskId: string,
    cwd: string,
    signal: AbortSignal,
  ): Promise<void> {
    await this.mustRun(taskId, "ADE configuration validation", {
      executable: this.adeExecutable,
      args: ["config", "validate"],
      cwd,
      env: this.gitEnvironment,
      signal,
      onOutput: (output) => this.logCommandOutput(taskId, output),
    });
    await this.mustRun(taskId, `ADE ${this.adeProfile} context pack`, {
      executable: this.adeExecutable,
      args: ["context", "pack", this.adeProfile],
      cwd,
      env: this.gitEnvironment,
      signal,
      onOutput: (output) => this.logCommandOutput(taskId, output),
    });
  }

  private async assertCheckoutStillClean(cwd: string): Promise<void> {
    const status = await this.git(cwd, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]);
    if (status.stdout.trim()) {
      throw new V0ExecutionError(
        "ADE_ARTIFACTS_UNIGNORED",
        "ADE context artifacts must be ignored before a task can start.",
      );
    }
  }

  private async git(cwd: string, args: readonly string[]): Promise<CommandResult> {
    const result = await this.options.commands.run({
      executable: "git",
      args: ["-c", "core.hooksPath=/dev/null", ...args],
      cwd,
      env: this.gitEnvironment,
    });
    if (result.exitCode !== 0) {
      throw new V0ExecutionError("GIT_COMMAND_FAILED", "A required Git operation failed.");
    }
    return result;
  }

  private async mustRun(
    taskId: string,
    label: string,
    input: Parameters<CommandRunner["run"]>[0],
  ): Promise<CommandResult> {
    await this.log(taskId, `${label} started.`);
    const result = await this.options.commands.run(input);
    if (result.exitCode !== 0) {
      throw new V0ExecutionError(
        `${label.toUpperCase().replace(/[^A-Z0-9]+/gu, "_")}_FAILED`,
        `${label} failed.`,
      );
    }
    return result;
  }

  private async logCommandOutput(taskId: string, output: CommandOutput): Promise<void> {
    await this.options.persistence.v0Tasks.appendLog({
      taskId,
      occurredAt: this.now().toISOString(),
      stream: output.stream,
      message: output.message,
    });
  }

  private async log(taskId: string, message: string): Promise<void> {
    await this.options.persistence.v0Tasks.appendLog({
      taskId,
      occurredAt: this.now().toISOString(),
      stream: "system",
      message,
    });
  }
}

class V0ExecutionError extends Error {
  public constructor(
    public readonly code: string,
    public readonly safeSummary: string,
  ) {
    super(safeSummary);
    this.name = "V0ExecutionError";
  }
}

class V0CancelledError extends Error {
  public constructor() {
    super("Task was cancelled.");
    this.name = "V0CancelledError";
  }
}

function classifyFailure(
  error: unknown,
  abortReason: AbortReason,
): { code: string; summary: string } {
  if (abortReason === "timeout") {
    return { code: "EXECUTION_TIMEOUT", summary: "Task exceeded its execution timeout." };
  }
  if (abortReason === "shutdown") {
    return { code: "WORKER_SHUTDOWN", summary: "Worker stopped during task execution." };
  }
  if (error instanceof V0ExecutionError) {
    return { code: error.code, summary: error.safeSummary };
  }
  return { code: "EXECUTION_FAILED", summary: "Task execution failed." };
}

function buildCodexPrompt(prompt: string, adeProfile: AdeProfile, issue: GithubIssueSummary | null): string {
  return [
    "Implement the following task in this repository.",
    "Keep the change scoped, follow AGENTS.md, and run the relevant checks.",
    `ADE has prepared the ${adeProfile} context profile for this task. Use the repository's ADE configuration and context pack as delivery guidance.`,
    "Do not commit, push, create a pull request, or expose credentials; the worker owns those steps.",
    ...(issue ? [
      "The selected GitHub issue is the authoritative work reference. Read only the issue context needed to implement it.",
      `GitHub issue #${issue.number}: ${issue.title}`,
      `Issue URL: ${issue.url}`,
    ] : []),
    "",
    "Task:",
    prompt,
  ].join("\n");
}

function buildPullRequestBody(task: V0TaskRecord, adeProfile: AdeProfile, issue: GithubIssueSummary | null): string {
  return [
    `Automated implementation for ADE Control Plane task \`${task.id}\`.`,
    ...(issue ? [`Source issue: #${issue.number} — ${issue.url}`] : []),
    `ADE deterministic staged review passed (context profile: \`${adeProfile}\`).`,
    "",
    "@dokor",
    "",
    "Review and merge remain explicit human actions.",
  ].join("\n");
}
