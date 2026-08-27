import type {
  AdeAdvanceResult,
  AdeClient,
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
  adeClient: AdeClient;
  getQuotaSnapshot(): Promise<ProviderQuotaSnapshot>;
  getProjects(): Promise<readonly ControlCycleProject[]>;
  getRunnerId(project: ControlCycleProject): Promise<string | null>;
  createExecutionId(project: ControlCycleProject): Promise<string>;
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
    const work = await dependencies.adeClient.getRunnableWork(project.ade);
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
  const result = await dependencies.adeClient.advance(project.ade, {
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
