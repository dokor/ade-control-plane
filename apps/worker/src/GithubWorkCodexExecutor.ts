import type { ProjectRecord } from "@ade-control-plane/database";
import type { GithubPullRequestClient } from "@ade-control-plane/github";

import type { GithubWorkDispatchRequest, GithubWorkDispatchResult, GithubWorkDispatcher } from "./GithubWorkOrchestrator.js";
import type { CommandRunner } from "./v0/CommandRunner.js";
import { matchesGithubRemote, resolveProjectCheckout } from "./v0/ProjectCheckout.js";

export interface GithubWorkCodexExecutorOptions {
  github: GithubPullRequestClient;
  commands: CommandRunner;
  projectRoot: string;
  codexExecutable?: string;
  gitEnvironment?: Readonly<Record<string, string>>;
  codexEnvironment?: Readonly<Record<string, string>>;
}

/**
 * Local trusted executor for one already-leased GitHub work item. All process
 * arguments are fixed arrays; the validated issue metadata is sent via stdin
 * to Codex and is never interpolated into a shell command.
 */
export class GithubWorkCodexExecutor implements GithubWorkDispatcher {
  private readonly codexExecutable: string;

  public constructor(private readonly options: GithubWorkCodexExecutorOptions) {
    this.codexExecutable = options.codexExecutable ?? "codex";
  }

  public async execute(request: GithubWorkDispatchRequest): Promise<GithubWorkDispatchResult> {
    let branchName: string | null = null;
    try {
      const checkout = await resolveProjectCheckout(this.options.projectRoot, request.project);
      branchName = request.work.branchName ?? `ade/issue-${request.work.issueNumber}`;
      const remote = await this.git(checkout.root, ["remote", "get-url", "origin"]);
      if (!matchesGithubRemote(remote.stdout, request.project.repositoryOwner, request.project.repositoryName)) {
        throw new GithubWorkExecutionError("REMOTE_MISMATCH", "Checkout origin does not match the registered GitHub repository.");
      }
      const initialStatus = await this.git(checkout.root, ["status", "--porcelain=v1", "--untracked-files=all"]);
      if (initialStatus.stdout.trim()) {
        throw new GithubWorkExecutionError("CHECKOUT_DIRTY", "Checkout contains changes from another operation.");
      }
      await this.mustRun("git fetch", {
        executable: "git", args: ["fetch", "--prune", "origin", checkout.baseBranch], cwd: checkout.root, env: this.gitEnvironment,
      });
      await this.mustRun("git branch preparation", {
        executable: "git", args: ["switch", "--force-create", branchName, `origin/${checkout.baseBranch}`], cwd: checkout.root, env: this.gitEnvironment,
      });
      await this.mustRun("Codex", {
        executable: this.codexExecutable,
        args: ["exec", "--sandbox", "workspace-write", "--ephemeral", "--json", "-"],
        cwd: checkout.root,
        stdin: buildGithubWorkPrompt(request),
        env: this.codexEnvironment,
      });
      const finalStatus = await this.git(checkout.root, ["status", "--porcelain=v1", "--untracked-files=all"]);
      if (!finalStatus.stdout.trim()) {
        throw new GithubWorkExecutionError("NO_CHANGES", "Codex completed without producing repository changes.");
      }
      await this.mustRun("git add", { executable: "git", args: ["add", "--all"], cwd: checkout.root, env: this.gitEnvironment });
      await this.mustRun("git commit", {
        executable: "git",
        args: ["-c", "user.name=ADE Control Plane", "-c", "user.email=ade-control-plane@localhost", "-c", "core.hooksPath=/dev/null", "commit", "-m", `feat: implement GitHub issue #${request.work.issueNumber}`],
        cwd: checkout.root, env: this.gitEnvironment,
      });
      await this.mustRun("git push", { executable: "git", args: ["push", "--set-upstream", "origin", branchName], cwd: checkout.root, env: this.gitEnvironment });
      const pullRequest = await this.options.github.createPullRequest(
        { id: request.work.repositoryGithubId, owner: request.project.repositoryOwner, name: request.project.repositoryName },
        {
          title: `ADE: issue #${request.work.issueNumber}`,
          body: [
            `Automated implementation for GitHub issue #${request.work.issueNumber}.`,
            `Source issue: ${request.work.issueUrl}`,
            "",
            "Review and merge remain explicit human actions.",
          ].join("\n"),
          head: branchName,
          base: checkout.baseBranch,
        },
      );
      return { status: "succeeded", resultSummary: { branchName, pullRequestNumber: pullRequest.number, pullRequestUrl: pullRequest.url } };
    } catch (error) {
      const failure = classifyFailure(error);
      return { status: "failed", errorCode: failure.code, errorSummary: failure.summary, ...(branchName ? { resultSummary: { branchName } } : {}) };
    }
  }

  private get gitEnvironment(): Readonly<Record<string, string>> { return this.options.gitEnvironment ?? {}; }
  private get codexEnvironment(): Readonly<Record<string, string>> { return this.options.codexEnvironment ?? {}; }

  private async git(cwd: string, args: readonly string[]) {
    const result = await this.options.commands.run({ executable: "git", args: ["-c", "core.hooksPath=/dev/null", ...args], cwd, env: this.gitEnvironment });
    if (result.exitCode !== 0) throw new GithubWorkExecutionError("GIT_COMMAND_FAILED", "A required Git operation failed.");
    return result;
  }

  private async mustRun(label: string, input: Parameters<CommandRunner["run"]>[0]) {
    const result = await this.options.commands.run(input);
    if (result.exitCode !== 0) {
      throw new GithubWorkExecutionError(`${label.toUpperCase().replace(/[^A-Z0-9]+/gu, "_")}_FAILED`, `${label} failed.`);
    }
    return result;
  }
}

class GithubWorkExecutionError extends Error {
  public constructor(public readonly code: string, public readonly safeSummary: string) { super(safeSummary); }
}

function classifyFailure(error: unknown): { code: string; summary: string } {
  if (error instanceof GithubWorkExecutionError) return { code: error.code, summary: error.safeSummary };
  return { code: "EXECUTION_FAILED", summary: "GitHub work execution failed." };
}

export function buildGithubWorkPrompt(request: GithubWorkDispatchRequest): string {
  const { work } = request;
  return [
    "Implement exactly the registered GitHub work item below in this repository.",
    "Follow AGENTS.md and the repository skills listed below. Run relevant checks.",
    "Do not commit, push, create a pull request, modify issue metadata, or expose credentials; the worker owns those steps.",
    "",
    `Issue: #${work.issueNumber} ${work.issueUrl}`,
    `State: ${work.state}; priority: ${work.priority}; dependencies: ${work.dependsOn.join(",") || "none"}.`,
    `Repository skills: ${request.skillPaths.join(", ") || "none"}.`,
    "",
    "The issue URL is the authoritative task reference. Do not infer work from labels, branch names or unrelated issue prose.",
  ].join("\n");
}
