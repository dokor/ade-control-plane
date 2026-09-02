import type {
  AdeAdvanceResult,
  AdeProjectRef,
  AdeRunnableWork,
} from "@ade-control-plane/ade-client";
import {
  selectNextProject,
  type ManagedProject,
  type RunnableProjectCandidate,
} from "@ade-control-plane/core";
import {
  evaluateQuota,
  type ProviderQuotaSnapshot,
  type QuotaDecision,
} from "@ade-control-plane/quota";

export interface ControlCycleProject extends ManagedProject {
  ade: AdeProjectRef;
}

export interface ControlCycleResult {
  state: "idle" | "quota-blocked" | "dispatched";
  reason: string;
  projectId?: string;
  work?: AdeRunnableWork;
  result?: AdeAdvanceResult;
}

export interface ControlCycleDependencies {
  /** Implemented by the UDS runner client; never by a worker shell transport. */
  runnerClient: Pick<RunnerControlPlaneClient, "getRunnableWork" | "advance">;
  getQuotaSnapshot(): Promise<ProviderQuotaSnapshot>;
  getProjects(): Promise<readonly ControlCycleProject[]>;
  getRunnerId(project: ControlCycleProject): Promise<string | null>;
  createExecutionId(project: ControlCycleProject): Promise<string>;
}

export interface RunnerControlPlaneClient {
  getRunnableWork(project: AdeProjectRef): Promise<AdeRunnableWork | null>;
  advance(project: AdeProjectRef, request: { controlPlaneExecutionId: string; workRef: string }): Promise<AdeAdvanceResult>;
  reconcile(project: AdeProjectRef, executionId: string, adeExecutionRef?: string): Promise<{
    state: "succeeded" | "failed" | "cancelled" | "unknown" | "running" | "not-found";
    summary?: string;
  }>;
}

/**
 * Executes one bounded scheduling cycle.
 * Persistence/leases will wrap this function before the worker is allowed
 * to run continuously on the Raspberry.
 */
export async function runControlCycle(
  dependencies: ControlCycleDependencies,
): Promise<ControlCycleResult> {
  const quota: QuotaDecision = evaluateQuota(
    await dependencies.getQuotaSnapshot(),
  );

  if (!quota.canStartWork) {
    return {
      state: "quota-blocked",
      reason: quota.reason,
    };
  }

  const projects = await dependencies.getProjects();
  const runnableWorkByProject = new Map<string, AdeRunnableWork>();
  const candidates: RunnableProjectCandidate[] = [];

  for (const project of projects) {
    const work = await dependencies.runnerClient.getRunnableWork(project.ade);
    if (work) runnableWorkByProject.set(project.id, work);

    candidates.push({
      project,
      hasRunnableWork: work !== null,
    });
  }

  const decision = selectNextProject(candidates);
  if (!decision.selectedProjectId) {
    return {
      state: "idle",
      reason: decision.reason,
    };
  }

  const project = projects.find(
    ({ id }) => id === decision.selectedProjectId,
  );
  const work = runnableWorkByProject.get(decision.selectedProjectId);

  if (!project || !work) {
    throw new Error("Scheduler selected a project without runnable work.");
  }

  const runnerId = await dependencies.getRunnerId(project);
  if (!runnerId) {
    return {
      state: "idle",
      projectId: project.id,
      reason: `Project ${project.id} has runnable work but no compatible runner is available.`,
    };
  }

  const executionId = await dependencies.createExecutionId(project);
  const result = await dependencies.runnerClient.advance(project.ade, {
    controlPlaneExecutionId: executionId,
    workRef: work.ref,
  });

  return {
    state: "dispatched",
    projectId: project.id,
    work,
    result,
    reason: decision.reason,
  };
}

export {
  NodeCommandRunner,
  type CommandInput,
  type CommandOutput,
  type CommandResult,
  type CommandRunner,
} from "./v0/CommandRunner.js";
export {
  ClaudeCodeAgentExecutor,
  CodexAgentExecutor,
  type AgentExecutionRequest,
  type AgentExecutor,
  type AgentProvider,
  type CommandAgentExecutorOptions,
} from "./AgentExecutor.js";
export {
  matchesGithubRemote,
  resolveProjectCheckout,
  type V0ProjectCheckout,
} from "./v0/ProjectCheckout.js";
export { V0TaskExecutor, type V0TaskExecutorOptions } from "./v0/V0TaskExecutor.js";
export { V0TaskWorker, type V0TaskWorkerOptions } from "./v0/V0TaskWorker.js";
export { provisionRegisteredProjects } from "./v0/ProjectProvisioner.js";
export {
  GithubWorkOrchestrator,
  type GithubWorkCycleResult,
  type GithubWorkDispatcher,
  type GithubWorkDispatchRequest,
  type GithubWorkDispatchResult,
  type GithubWorkOrchestratorOptions,
} from "./GithubWorkOrchestrator.js";
export {
  GithubWorkCodexExecutor,
  buildGithubWorkPrompt,
  type GithubWorkCodexExecutorOptions,
} from "./GithubWorkCodexExecutor.js";
export {
  AdeDeliveryError,
  AdeDeliveryRuntime,
  type AdeDeliveryProvenance,
  type AdeDeliveryReviewResult,
  type AdeDeliveryWorkContext,
  type AdeProfileFinding,
} from "./AdeDeliveryRuntime.js";
export { GithubWorkNotifier, type GithubWorkNotifierOptions } from "./GithubWorkNotifier.js";
export {
  UnixRunnerControlPlaneClient,
  type UnixRunnerControlPlaneClientOptions,
  type UnixRunnerProjectBinding,
} from "./UnixRunnerControlPlaneClient.js";
