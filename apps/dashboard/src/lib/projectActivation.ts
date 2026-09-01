import type { ControlPlanePersistence, ProjectRecord, V0TaskRecord } from "@ade-control-plane/database";

import { createTask } from "./tasks.js";
import type { GithubRuntime } from "./githubRuntime.js";
import { prepareProjectSetup, type SetupMutationResult } from "./projectSetup.js";

export interface ProjectActivationResult extends SetupMutationResult {
  initializationTask: V0TaskRecord | null;
}

/** One entry point: repair repository setup, then queue ADE initialization. */
export async function prepareProjectActivation(
  persistence: ControlPlanePersistence,
  project: ProjectRecord,
  runtime: GithubRuntime | null,
): Promise<ProjectActivationResult> {
  const result = await prepareProjectSetup(project, runtime);
  if (!result.readiness.ready) {
    return { ...result, initializationTask: null };
  }
  const initializationTask = await createTask(persistence, {
    projectId: project.id,
    source: { type: "ade-initialize" },
  });
  await persistence.wakeups?.signal({
    reason: "ade-initialization",
    projectId: project.id,
    signaledAt: new Date().toISOString(),
  });
  return { ...result, initializationTask };
}
