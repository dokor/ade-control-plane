export type ProjectId = string;

export type ProjectControlState = "enabled" | "paused" | "disabled";

export interface ManagedProject {
  id: ProjectId;
  repository: string;
  priority: number;
  controlState: ProjectControlState;
  requiredRunnerLabels?: readonly string[];
}

export type GlobalWaitingReason =
  | "idle"
  | "quota"
  | "human"
  | "runner"
  | "paused";

export interface RunnableProjectCandidate {
  project: ManagedProject;
  hasRunnableWork: boolean;
  waitingReason?: GlobalWaitingReason;
  lastSuccessfulExecutionAt?: string;
}

export interface SchedulerDecision {
  selectedProjectId: ProjectId | null;
  reason: string;
  consideredProjectIds: readonly ProjectId[];
}

/**
 * Deterministic V0 selection rule. ADE remains responsible for deciding
 * whether project-level work is actually runnable; the control plane only
 * selects among eligible projects.
 */
export function selectNextProject(
  candidates: readonly RunnableProjectCandidate[],
): SchedulerDecision {
  const eligible = candidates
    .filter(({ project, hasRunnableWork, waitingReason }) =>
      project.controlState === "enabled" &&
      hasRunnableWork &&
      waitingReason === undefined,
    )
    .toSorted((left, right) => {
      const priorityDelta = right.project.priority - left.project.priority;
      if (priorityDelta !== 0) return priorityDelta;

      const leftLastRun = left.lastSuccessfulExecutionAt ?? "";
      const rightLastRun = right.lastSuccessfulExecutionAt ?? "";
      return leftLastRun.localeCompare(rightLastRun);
    });

  const selected = eligible[0];

  if (!selected) {
    return {
      selectedProjectId: null,
      reason: "No project satisfies control state, ADE runnable work, quota and runner gates.",
      consideredProjectIds: candidates.map(({ project }) => project.id),
    };
  }

  return {
    selectedProjectId: selected.project.id,
    reason: `Selected ${selected.project.id}: highest eligible priority (${selected.project.priority}) with deterministic aging tie-break.`,
    consideredProjectIds: candidates.map(({ project }) => project.id),
  };
}
