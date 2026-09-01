import type { AgentUsageMetrics, ProjectRecord } from "@ade-control-plane/database";
import { DEFAULT_GITHUB_WORK_METADATA, readGithubWorkMetadata, upsertGithubWorkMetadata, type GithubIssueLifecycleClient, type GithubPullRequestClient } from "@ade-control-plane/github";

import type { GithubWorkDispatchRequest, GithubWorkDispatchResult, GithubWorkDispatcher } from "./GithubWorkOrchestrator.js";
import type { CommandRunner } from "./v0/CommandRunner.js";
import { CodexAgentExecutor, type AgentExecutor } from "./AgentExecutor.js";
import { AdeDeliveryError, AdeDeliveryRuntime } from "./AdeDeliveryRuntime.js";
import { matchesGithubRemote, ProjectCheckoutError, resolveProjectCheckout } from "./v0/ProjectCheckout.js";

export interface GithubWorkCodexExecutorOptions {
  github: GithubPullRequestClient & GithubIssueLifecycleClient;
  commands: CommandRunner;
  projectRoot: string;
  codexExecutable?: string;
  agentExecutor?: AgentExecutor;
  deliveryRuntime?: AdeDeliveryRuntime;
  adeExecutable?: string;
  adeRuntimeVersion?: string;
  adeContextProfile?: string;
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
  private readonly agentExecutor: AgentExecutor;
  private readonly deliveryRuntime: AdeDeliveryRuntime;

  public constructor(private readonly options: GithubWorkCodexExecutorOptions) {
    this.codexExecutable = options.codexExecutable ?? "codex";
    this.agentExecutor = options.agentExecutor ?? new CodexAgentExecutor({
      commands: options.commands,
      executable: this.codexExecutable,
      environment: options.codexEnvironment ?? {},
    });
    this.deliveryRuntime = options.deliveryRuntime ?? new AdeDeliveryRuntime({
      commands: options.commands,
      ...(options.adeExecutable ? { executable: options.adeExecutable } : {}),
      ...(options.adeRuntimeVersion ? { expectedVersion: options.adeRuntimeVersion } : {}),
      ...(options.gitEnvironment ? { environment: options.gitEnvironment } : {}),
    });
  }

  public async execute(request: GithubWorkDispatchRequest): Promise<GithubWorkDispatchResult> {
    let branchName: string | null = null;
    let usage: AgentUsageMetrics | undefined;
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
      let issue = await this.options.github.getIssueDetails(
        { id: request.work.repositoryGithubId, owner: request.project.repositoryOwner, name: request.project.repositoryName },
        request.work.issueNumber,
      );
      if (!issue || issue.state !== "open") throw new GithubWorkExecutionError("GITHUB_ISSUE_NOT_FOUND", "The selected GitHub issue is no longer open.");
      const lifecycle = await this.planIssueLifecycle(checkout.root, issue);
      if (lifecycle.action === "enrich") {
        if (!lifecycle.enrichmentPrompt) throw new GithubWorkExecutionError("ADE_ISSUE_PLAN_INVALID", "ADE did not provide a safe enrichment instruction.");
        const enrichment = await this.agentExecutor.execute({ cwd: checkout.root, prompt: lifecycle.enrichmentPrompt });
        if (enrichment.exitCode !== 0) throw new GithubWorkExecutionError("ISSUE_ENRICHMENT_FAILED", "ADE issue enrichment failed.");
        const enrichedBody = extractAgentText(enrichment.stdout);
        if (!enrichedBody || new TextEncoder().encode(enrichedBody).byteLength > 24 * 1024) throw new GithubWorkExecutionError("ISSUE_ENRICHMENT_INVALID", "ADE issue enrichment did not return a valid issue body.");
        const changed = await this.git(checkout.root, ["status", "--porcelain=v1", "--untracked-files=all"]);
        if (changed.stdout.trim()) throw new GithubWorkExecutionError("ISSUE_ENRICHMENT_DIRTY", "Issue enrichment must not modify the repository.");
        const metadata = readGithubWorkMetadata(issue.body) ?? DEFAULT_GITHUB_WORK_METADATA;
        issue = await this.options.github.updateIssueBody(
          { id: request.work.repositoryGithubId, owner: request.project.repositoryOwner, name: request.project.repositoryName }, request.work.issueNumber,
          upsertGithubWorkMetadata(enrichedBody, metadata),
        );
      } else if (lifecycle.action === "wait" || lifecycle.action === "none") {
        return { status: "cancelled", provider: this.agentExecutor.provider, errorCode: "ISSUE_LIFECYCLE_WAIT", errorSummary: lifecycle.reason };
      }
      await this.updateLifecycle(issue.body, request, { state: "running", executionRef: request.executionId, branchName });
      const work = {
        project: request.project,
        source: "github-issue" as const,
        prompt: `Implement GitHub issue #${request.work.issueNumber}.`,
        issueNumber: request.work.issueNumber,
      };
      const prepared = await this.deliveryRuntime.prepare({
        cwd: checkout.root,
        work,
        ...(this.options.adeContextProfile ? { contextProfile: this.options.adeContextProfile } : {}),
      });
      const agentResult = await this.agentExecutor.execute({
        cwd: checkout.root,
        prompt: buildGithubWorkPrompt(request),
      });
      usage = agentResult.usage;
      if (agentResult.exitCode !== 0) {
        throw new GithubWorkExecutionError("AGENT_EXECUTION_FAILED", `${this.agentExecutor.provider} execution failed.`);
      }
      const finalStatus = await this.git(checkout.root, ["status", "--porcelain=v1", "--untracked-files=all"]);
      if (!finalStatus.stdout.trim()) {
        throw new GithubWorkExecutionError("NO_CHANGES", "Codex completed without producing repository changes.");
      }
      const review = await this.deliveryRuntime.runPostAgentGates({
        cwd: checkout.root,
        work,
        agentExecutor: this.agentExecutor,
        prepared,
      });
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
            "## ADE runtime",
            ...Object.entries(AdeDeliveryRuntime.provenanceSummary(review.provenance)).map(([key, value]) => `- ${key}: ${value}`),
            "",
            "Review and merge remain explicit human actions.",
          ].join("\n"),
          head: branchName,
          base: checkout.baseBranch,
        },
      );
      await this.updateLifecycle(issue.body, request, { state: "waiting-human", executionRef: request.executionId, branchName, pullRequestNumber: pullRequest.number });
      return { status: "succeeded", provider: this.agentExecutor.provider, ...(usage ? { usage } : {}), resultSummary: { branchName, pullRequestNumber: pullRequest.number, pullRequestUrl: pullRequest.url, ...AdeDeliveryRuntime.provenanceSummary(review.provenance) } };
    } catch (error) {
      const failure = classifyFailure(error);
      return { status: "failed", provider: this.agentExecutor.provider, ...(usage ? { usage } : {}), errorCode: failure.code, errorSummary: failure.summary, ...(branchName ? { resultSummary: { branchName } } : {}) };
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

  private async planIssueLifecycle(cwd: string, issue: { number: number; title: string; body: string; labels: readonly string[]; state: "open" | "closed"; url: string }) {
    const result = await this.options.commands.run({ executable: this.options.adeExecutable ?? "ade", args: ["issue", "plan", "--json"], cwd, stdin: JSON.stringify({ issue }) });
    if (result.exitCode !== 0) throw new GithubWorkExecutionError("ADE_ISSUE_PLAN_FAILED", "ADE could not resolve the issue lifecycle.");
    const parsed: unknown = JSON.parse(result.stdout);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new GithubWorkExecutionError("ADE_ISSUE_PLAN_INVALID", "ADE returned an invalid issue lifecycle plan.");
    const plan = parsed as { action?: unknown; reason?: unknown; enrichmentPrompt?: unknown };
    if ((plan.action !== "enrich" && plan.action !== "develop" && plan.action !== "wait" && plan.action !== "none") || typeof plan.reason !== "string") throw new GithubWorkExecutionError("ADE_ISSUE_PLAN_INVALID", "ADE returned an invalid issue lifecycle plan.");
    if (plan.action === "enrich" && (typeof plan.enrichmentPrompt !== "string" || plan.enrichmentPrompt.length === 0 || plan.enrichmentPrompt.length > 30_000)) throw new GithubWorkExecutionError("ADE_ISSUE_PLAN_INVALID", "ADE did not provide a safe enrichment instruction.");
    return { action: plan.action, reason: plan.reason, enrichmentPrompt: plan.enrichmentPrompt as string | undefined };
  }

  private async updateLifecycle(body: string, request: GithubWorkDispatchRequest, change: Partial<import("@ade-control-plane/github").GithubWorkMetadata>): Promise<void> {
    const metadata = { ...(readGithubWorkMetadata(body) ?? DEFAULT_GITHUB_WORK_METADATA), ...change };
    await this.options.github.updateIssueBody({ id: request.work.repositoryGithubId, owner: request.project.repositoryOwner, name: request.project.repositoryName }, request.work.issueNumber, upsertGithubWorkMetadata(body, metadata));
  }
}

class GithubWorkExecutionError extends Error {
  public constructor(public readonly code: string, public readonly safeSummary: string) { super(safeSummary); }
}

function classifyFailure(error: unknown): { code: string; summary: string } {
  if (error instanceof AdeDeliveryError) return { code: error.code, summary: error.safeSummary };
  if (error instanceof ProjectCheckoutError) return { code: error.code, summary: error.safeSummary };
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

function extractAgentText(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/u).toReversed()) {
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const record = value as { result?: unknown; text?: unknown; item?: { text?: unknown; content?: unknown } };
        const candidate = typeof record.result === "string" ? record.result : typeof record.text === "string" ? record.text : typeof record.item?.text === "string" ? record.item.text : typeof record.item?.content === "string" ? record.item.content : null;
        if (candidate) return candidate.trim();
      }
    } catch { /* provider may emit non-JSON progress lines */ }
  }
  return null;
}
